import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  AppError,
  redactSensitiveText,
  redactStructuredRecord,
  type WorkflowExecutionRecord,
  type WorkflowExecutionStatus,
  type WorkflowName,
} from '@vaarg/shared';
import { scopedStoreTransaction } from '../commerce/scope.js';
import { hashPayloadSha256 } from '../intelligence/intelligence-repository.js';

function iso(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return new Date(val).toISOString();
  return new Date().toISOString();
}

function nullableIso(val: unknown): string | null {
  if (!val) return null;
  return iso(val);
}

function mapWorkflowExecutionRow(row: Record<string, unknown>): WorkflowExecutionRecord {
  return {
    executionId: String(row.execution_id),
    storeId: String(row.store_id),
    workflowName: String(row.workflow_name) as WorkflowName,
    idempotencyKey: String(row.idempotency_key),
    correlationId: String(row.correlation_id),
    concurrencyKey: row.concurrency_key ? String(row.concurrency_key) : null,
    hatchetWorkflowRunId: row.hatchet_workflow_run_id ? String(row.hatchet_workflow_run_id) : null,
    outboxEventId: row.outbox_event_id ? String(row.outbox_event_id) : null,
    status: String(row.status) as WorkflowExecutionStatus,
    payloadHash: String(row.payload_hash),
    resultSummary: (row.result_summary as Record<string, unknown> | null | undefined) ?? null,
    attempts: Number(row.attempts),
    lastError: row.last_error ? String(row.last_error) : null,
    submittedAt: nullableIso(row.submitted_at),
    startedAt: nullableIso(row.started_at),
    completedAt: nullableIso(row.completed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export type WorkflowSubmissionClaimResult =
  | { kind: 'claimed'; record: WorkflowExecutionRecord }
  | { kind: 'already_dispatched'; record: WorkflowExecutionRecord }
  | { kind: 'needs_reconciliation'; record: WorkflowExecutionRecord };

export async function claimWorkflowSubmissionRecord(
  pool: Pool,
  params: {
    storeId: string;
    workflowName: WorkflowName;
    idempotencyKey: string;
    correlationId: string;
    concurrencyKey?: string | undefined;
    outboxEventId?: string | undefined;
    inputPayload: Record<string, unknown>;
  },
): Promise<WorkflowSubmissionClaimResult> {
  const inputRedacted = redactStructuredRecord(params.inputPayload);
  const payloadHash = hashPayloadSha256(params.inputPayload);

  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const existingRes = await client.query(
      `SELECT * FROM workflow_executions
        WHERE store_id = $1 AND workflow_name = $2 AND idempotency_key = $3
        FOR UPDATE`,
      [params.storeId, params.workflowName, params.idempotencyKey],
    );
    const existingRow = existingRes.rows[0] as Record<string, unknown> | undefined;
    if (existingRow) {
      const record = mapWorkflowExecutionRow(existingRow);
      if (record.payloadHash !== payloadHash) {
        throw AppError.conflict(
          `WORKFLOW_IDEMPOTENCY_CONFLICT: Input payload mismatch for workflow "${params.workflowName}" and key "${params.idempotencyKey}"`,
        );
      }
      if (record.status === 'submission_unknown') {
        return { kind: 'needs_reconciliation', record };
      }
      if (
        record.status === 'submitted' ||
        record.status === 'running' ||
        record.status === 'continuation_required' ||
        record.status === 'completed' ||
        record.status === 'cancelled'
      ) {
        return { kind: 'already_dispatched', record };
      }
      // Retry from `pending_submission` or `failed`
      const reclaimed = await client.query(
        `UPDATE workflow_executions
            SET status = 'pending_submission',
                attempts = attempts + 1,
                updated_at = now()
          WHERE store_id = $1 AND execution_id = $2
          RETURNING *`,
        [params.storeId, record.executionId],
      );
      return {
        kind: 'claimed',
        record: mapWorkflowExecutionRow(reclaimed.rows[0] as Record<string, unknown>),
      };
    }

    const executionId = randomUUID();
    const inserted = await client.query(
      `INSERT INTO workflow_executions (
         store_id, execution_id, workflow_name, idempotency_key,
         correlation_id, concurrency_key, outbox_event_id,
         status, payload_hash, input_redacted, attempts
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_submission', $8, $9::jsonb, 1)
       RETURNING *`,
      [
        params.storeId,
        executionId,
        params.workflowName,
        params.idempotencyKey,
        params.correlationId,
        params.concurrencyKey ?? null,
        params.outboxEventId ?? null,
        payloadHash,
        JSON.stringify(inputRedacted),
      ],
    );
    return {
      kind: 'claimed',
      record: mapWorkflowExecutionRow(inserted.rows[0] as Record<string, unknown>),
    };
  });
}

export async function recordWorkflowNotImplemented(
  pool: Pool,
  params: {
    storeId: string;
    workflowName: WorkflowName;
    idempotencyKey: string;
    correlationId: string;
    inputPayload: Record<string, unknown>;
    reason: string;
  },
): Promise<WorkflowExecutionRecord> {
  const inputRedacted = redactStructuredRecord(params.inputPayload);
  const payloadHash = hashPayloadSha256(params.inputPayload);
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO workflow_executions (
         store_id, execution_id, workflow_name, idempotency_key,
         correlation_id, status, payload_hash, input_redacted, last_error, completed_at
       ) VALUES ($1, $2, $3, $4, $5, 'not_implemented', $6, $7::jsonb, $8, now())
       ON CONFLICT (store_id, workflow_name, idempotency_key) DO UPDATE
         SET status = 'not_implemented',
             last_error = EXCLUDED.last_error,
             updated_at = now()
       RETURNING *`,
      [
        params.storeId,
        randomUUID(),
        params.workflowName,
        params.idempotencyKey,
        params.correlationId,
        payloadHash,
        JSON.stringify(inputRedacted),
        params.reason.slice(0, 500),
      ],
    );
    return mapWorkflowExecutionRow(rows[0] as Record<string, unknown>);
  });
}

export async function markWorkflowSubmittedRecord(
  pool: Pool,
  params: {
    storeId: string;
    executionId: string;
    hatchetWorkflowRunId: string;
    outboxEventId?: string | null;
  },
): Promise<WorkflowExecutionRecord> {
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const { rows } = await client.query(
      `UPDATE workflow_executions
          SET status = CASE
                WHEN status IN ('pending_submission', 'submission_unknown') THEN 'submitted'
                ELSE status
              END,
              hatchet_workflow_run_id = $3,
              submitted_at = COALESCE(submitted_at, now()),
              last_error = NULL,
              updated_at = now()
        WHERE store_id = $1 AND execution_id = $2
        RETURNING *`,
      [params.storeId, params.executionId, params.hatchetWorkflowRunId],
    );
    if (params.outboxEventId) {
      await client.query(
        `UPDATE outbox_events
            SET status = 'dispatched',
                dispatched_at = now(),
                attempts = attempts + 1
          WHERE store_id = $1 AND event_id = $2`,
        [params.storeId, params.outboxEventId],
      );
    }
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) throw AppError.notFound('Workflow execution record not found');
    return mapWorkflowExecutionRow(row);
  });
}

export async function markWorkflowSubmissionUnknownRecord(
  pool: Pool,
  params: {
    storeId: string;
    executionId: string;
    errorMessage: string;
  },
): Promise<WorkflowExecutionRecord> {
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const { rows } = await client.query(
      `UPDATE workflow_executions
          SET status = 'submission_unknown',
              last_error = $3,
              updated_at = now()
        WHERE store_id = $1 AND execution_id = $2
        RETURNING *`,
      [params.storeId, params.executionId, redactSensitiveText(params.errorMessage, 500)],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) throw AppError.notFound('Workflow execution record not found');
    return mapWorkflowExecutionRow(row);
  });
}

export async function markWorkflowLifecycleStatus(
  pool: Pool,
  params: {
    storeId: string;
    executionId?: string;
    hatchetWorkflowRunId?: string;
    status:
      | 'running'
      | 'continuation_required'
      | 'completed'
      | 'failed'
      | 'cancelled'
      | 'authorization_expired';
    resultSummary?: Record<string, unknown>;
    errorMessage?: string;
  },
): Promise<WorkflowExecutionRecord | null> {
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const whereClause = params.executionId
      ? 'store_id = $1 AND execution_id = $2'
      : 'store_id = $1 AND hatchet_workflow_run_id = $2';
    const lookupKey = params.executionId ?? params.hatchetWorkflowRunId;
    if (!lookupKey) return null;

    const isTerminal =
      params.status === 'continuation_required' ||
      params.status === 'completed' ||
      params.status === 'failed' ||
      params.status === 'cancelled' ||
      params.status === 'authorization_expired';

    const { rows } = await client.query(
      `UPDATE workflow_executions
          SET status = CASE
                WHEN status = 'continuation_required' AND $3 = 'completed' AND $5::jsonb IS NULL
                  THEN 'continuation_required'
                ELSE $3
              END,
              started_at = CASE WHEN $3 = 'running' THEN COALESCE(started_at, now()) ELSE started_at END,
              completed_at = CASE WHEN $4::boolean THEN COALESCE(completed_at, now()) ELSE completed_at END,
              result_summary = COALESCE($5::jsonb, result_summary),
              last_error = COALESCE($6, last_error),
              updated_at = now()
        WHERE ${whereClause}
        RETURNING *`,
      [
        params.storeId,
        lookupKey,
        params.status,
        isTerminal,
        params.resultSummary ? JSON.stringify(redactStructuredRecord(params.resultSummary)) : null,
        params.errorMessage ? redactSensitiveText(params.errorMessage, 500) : null,
      ],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? mapWorkflowExecutionRow(row) : null;
  });
}

export async function getWorkflowExecutionRecord(
  pool: Pool,
  storeId: string,
  executionId: string,
): Promise<WorkflowExecutionRecord | null> {
  return scopedStoreTransaction(pool, storeId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM workflow_executions
        WHERE store_id = $1 AND execution_id = $2
        LIMIT 1`,
      [storeId, executionId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? mapWorkflowExecutionRow(row) : null;
  });
}
