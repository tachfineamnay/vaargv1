import {
  IdempotencyCollisionError,
  Priority,
  type HatchetClient,
  type JsonObject,
} from '@hatchet-dev/typescript-sdk';
import type { Pool } from 'pg';
import {
  AppError,
  WORKFLOW_CONTRACT_REGISTRY,
  type WorkflowExecutionRecord,
  type WorkflowExecutionStatus,
  type WorkflowName,
  type WorkflowOrchestrationPort,
} from '@vaarg/shared';
import type { z } from 'zod';
import {
  createHatchetSdkClient,
  resolveHatchetSdkConfig,
} from './hatchet-config.js';
import {
  claimWorkflowSubmissionRecord,
  getWorkflowExecutionRecord,
  markWorkflowLifecycleStatus,
  markWorkflowSubmissionUnknownRecord,
  markWorkflowSubmittedRecord,
  recordWorkflowNotImplemented,
} from './workflow-repository.js';

export interface HatchetSdkDriver {
  triggerWorkflow(
    workflowName: string,
    input: Record<string, unknown>,
    metadata: Record<string, string>,
  ): Promise<{ workflowRunId: string }>;
  getRunStatus(workflowRunId: string): Promise<string>;
  findRunByExecutionId(executionId: string): Promise<string | null>;
  cancelRun(workflowRunId: string): Promise<void>;
}

export function createRealHatchetSdkDriver(client: HatchetClient): HatchetSdkDriver {
  return {
    async triggerWorkflow(workflowName, input, metadata) {
      const ref = await client.runNoWait(workflowName, input as JsonObject, {
        additionalMetadata: metadata,
        priority: Priority.MEDIUM,
      });
      const workflowRunId = await ref.getWorkflowRunId();
      return { workflowRunId };
    },
    async getRunStatus(workflowRunId) {
      const rawStatus = await client.runs.get_status(workflowRunId);
      return String(rawStatus);
    },
    async findRunByExecutionId(executionId) {
      const list = await client.runs.list({
        additionalMetadata: { vaargExecutionId: executionId },
      });
      const first = list.rows?.[0] as { workflowRunExternalId?: string; metadata?: { id?: string } } | undefined;
      return first?.workflowRunExternalId ?? first?.metadata?.id ?? null;
    },
    async cancelRun(workflowRunId) {
      await client.runs.cancel({ ids: [workflowRunId] });
    },
  };
}

function mapHatchetStatusToExecutionStatus(raw: string): WorkflowExecutionStatus {
  const upper = raw.toUpperCase();
  if (upper.includes('COMPLETED') || upper.includes('SUCCEEDED')) return 'completed';
  if (upper.includes('CANCEL')) return 'cancelled';
  if (upper.includes('FAIL')) return 'failed';
  if (upper.includes('RUNNING')) return 'running';
  return 'submitted';
}

export class HatchetWorkflowDispatcher implements WorkflowOrchestrationPort {
  private readonly pool: Pool;
  private readonly driver: HatchetSdkDriver | null;
  private readonly readinessState: { status: 'READY' | 'NOT_CONFIGURED' | 'NOT_READY'; detail: string };

  constructor(
    pool: Pool,
    driver: HatchetSdkDriver | null,
    readinessState: { status: 'READY' | 'NOT_CONFIGURED' | 'NOT_READY'; detail: string },
  ) {
    this.pool = pool;
    this.driver = driver;
    this.readinessState = readinessState;
  }

  static fromEnv(
    pool: Pool,
    env: Record<string, string | undefined> = process.env,
  ): HatchetWorkflowDispatcher {
    const resolved = resolveHatchetSdkConfig(env);
    if (resolved.status === 'NOT_CONFIGURED') {
      return new HatchetWorkflowDispatcher(pool, null, {
        status: 'NOT_CONFIGURED',
        detail: resolved.detail,
      });
    }
    const client = createHatchetSdkClient(resolved.config);
    return new HatchetWorkflowDispatcher(
      pool,
      createRealHatchetSdkDriver(client),
      {
        status: 'READY',
        detail: `Hatchet SDK configured for worker "${resolved.config.workerName}"`,
      },
    );
  }

  readiness(): { status: 'READY' | 'NOT_CONFIGURED' | 'NOT_READY'; detail: string } {
    return this.readinessState;
  }

  async submitWorkflow<TName extends WorkflowName>(
    workflowName: TName,
    rawInput: z.input<(typeof WORKFLOW_CONTRACT_REGISTRY)[TName]['inputSchema']>,
    options?: { outboxEventId?: string },
  ): Promise<WorkflowExecutionRecord> {
    const contract = WORKFLOW_CONTRACT_REGISTRY[workflowName];
    if (!contract) {
      throw AppError.badRequest(`UNKNOWN_WORKFLOW: "${String(workflowName)}" is not a registered contract`);
    }

    const parsedResult = contract.inputSchema.safeParse(rawInput);
    if (!parsedResult.success) {
      throw AppError.badRequest(
        `INVALID_WORKFLOW_INPUT: ${parsedResult.error.issues.map((i) => i.message).join('; ')}`,
      );
    }
    const input = parsedResult.data as Record<string, unknown> & {
      storeId: string;
      idempotencyKey: string;
      correlationId: string;
      concurrencyKey: string;
    };

    // Task 9: Unimplemented future workflow contracts MUST NEVER report successful execution
    if (!contract.implemented) {
      const reason = `WORKFLOW_NOT_IMPLEMENTED: "${workflowName}" is planned for ${contract.implementedIn} and has no active worker handler`;
      await recordWorkflowNotImplemented(this.pool, {
        storeId: input.storeId,
        workflowName,
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        inputPayload: input,
        reason,
      });
      throw AppError.unavailable(reason);
    }

    if (!this.driver || this.readinessState.status !== 'READY') {
      throw AppError.unavailable(
        `HATCHET_NOT_CONFIGURED: Cannot dispatch "${workflowName}" (${this.readinessState.detail})`,
      );
    }

    const claim = await claimWorkflowSubmissionRecord(this.pool, {
      storeId: input.storeId,
      workflowName,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
      concurrencyKey: input.concurrencyKey,
      outboxEventId: options?.outboxEventId,
      inputPayload: input,
    });

    if (claim.kind === 'already_dispatched') {
      return claim.record;
    }

    if (claim.kind === 'needs_reconciliation') {
      // Reconcile ambiguous previous submission before ever re-triggering
      const existingHatchetId = await this.driver
        .findRunByExecutionId(claim.record.executionId)
        .catch(() => null);
      if (existingHatchetId) {
        return markWorkflowSubmittedRecord(this.pool, {
          storeId: input.storeId,
          executionId: claim.record.executionId,
          hatchetWorkflowRunId: existingHatchetId,
          outboxEventId: options?.outboxEventId ?? claim.record.outboxEventId,
        });
      }
      if (contract.nonIdempotentExternalEffects) {
        throw AppError.conflict(
          `WORKFLOW_SUBMISSION_UNKNOWN: Previous submission of non-idempotent workflow "${workflowName}" has ambiguous outcome; manual reconciliation required`,
        );
      }
    }

    const execution = claim.record;
    try {
      const triggered = await this.driver.triggerWorkflow(workflowName, input, {
        vaargExecutionId: execution.executionId,
        storeId: input.storeId,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        workflowName,
      });

      return await markWorkflowSubmittedRecord(this.pool, {
        storeId: input.storeId,
        executionId: execution.executionId,
        hatchetWorkflowRunId: triggered.workflowRunId,
        outboxEventId: options?.outboxEventId ?? execution.outboxEventId,
      });
    } catch (err) {
      if (err instanceof IdempotencyCollisionError) {
        const reconciledId = await this.driver
          .findRunByExecutionId(execution.executionId)
          .catch(() => null);
        if (reconciledId) {
          return markWorkflowSubmittedRecord(this.pool, {
            storeId: input.storeId,
            executionId: execution.executionId,
            hatchetWorkflowRunId: reconciledId,
            outboxEventId: options?.outboxEventId ?? execution.outboxEventId,
          });
        }
      }

      const message = err instanceof Error ? err.message : 'Unknown Hatchet submission failure';
      await markWorkflowSubmissionUnknownRecord(this.pool, {
        storeId: input.storeId,
        executionId: execution.executionId,
        errorMessage: message,
      });
      throw AppError.unavailable(`HATCHET_SUBMISSION_FAILED: ${message}`);
    }
  }

  async getWorkflowExecution(
    storeId: string,
    executionId: string,
  ): Promise<WorkflowExecutionRecord | null> {
    const existing = await getWorkflowExecutionRecord(this.pool, storeId, executionId);
    if (!existing) return null;

    if (
      this.driver &&
      existing.hatchetWorkflowRunId &&
      (existing.status === 'submitted' || existing.status === 'running')
    ) {
      try {
        const rawStatus = await this.driver.getRunStatus(existing.hatchetWorkflowRunId);
        const mapped = mapHatchetStatusToExecutionStatus(rawStatus);
        if (
          mapped !== existing.status &&
          (mapped === 'running' ||
            mapped === 'completed' ||
            mapped === 'failed' ||
            mapped === 'cancelled')
        ) {
          const updated = await markWorkflowLifecycleStatus(this.pool, {
            storeId,
            executionId,
            status: mapped,
          });
          if (updated) return updated;
        }
      } catch {
        // Return durable PostgreSQL record when Hatchet query transiently fails
      }
    }

    return existing;
  }

  async cancelWorkflowExecution(
    storeId: string,
    executionId: string,
  ): Promise<WorkflowExecutionRecord> {
    const existing = await getWorkflowExecutionRecord(this.pool, storeId, executionId);
    if (!existing) {
      throw AppError.notFound('Workflow execution not found');
    }
    if (
      existing.status === 'completed' ||
      existing.status === 'failed' ||
      existing.status === 'cancelled' ||
      existing.status === 'not_implemented'
    ) {
      return existing;
    }

    if (this.driver && existing.hatchetWorkflowRunId) {
      await this.driver.cancelRun(existing.hatchetWorkflowRunId);
    }

    const cancelled = await markWorkflowLifecycleStatus(this.pool, {
      storeId,
      executionId,
      status: 'cancelled',
    });
    if (!cancelled) {
      throw AppError.notFound('Workflow execution not found');
    }
    return cancelled;
  }
}
