import { z } from 'zod';

export const HATCHET_PINNED_SDK_VERSION = '1.49.1' as const;

export const IMPLEMENTED_WORKFLOW_NAMES = [
  'vaarg.catalog.sync',
  'vaarg.embeddings.refresh',
  'vaarg.experience.retention_cleanup',
] as const;
export const implementedWorkflowNameSchema = z.enum(IMPLEMENTED_WORKFLOW_NAMES);
export type ImplementedWorkflowName = z.infer<typeof implementedWorkflowNameSchema>;

export const FUTURE_WORKFLOW_NAMES = [
  'vaarg.shopify.webhook_reconciliation',
  'vaarg.memory.consolidation',
  'vaarg.cdp.customer_segmentation',
  'vaarg.marketing.campaign_preparation',
  'vaarg.marketing.campaign_dispatch',
  'vaarg.privacy.deletion_propagation',
  'vaarg.support.case_processing',
] as const;
export const futureWorkflowNameSchema = z.enum(FUTURE_WORKFLOW_NAMES);
export type FutureWorkflowName = z.infer<typeof futureWorkflowNameSchema>;

export const ALL_WORKFLOW_NAMES = [
  ...IMPLEMENTED_WORKFLOW_NAMES,
  ...FUTURE_WORKFLOW_NAMES,
] as const;
export const workflowNameSchema = z.enum(ALL_WORKFLOW_NAMES);
export type WorkflowName = z.infer<typeof workflowNameSchema>;

export const WORKFLOW_EXECUTION_STATUSES = [
  'pending_submission',
  'submission_unknown',
  'submitted',
  'running',
  'continuation_required',
  'completed',
  'failed',
  'cancelled',
  'not_implemented',
] as const;
export const workflowExecutionStatusSchema = z.enum(WORKFLOW_EXECUTION_STATUSES);
export type WorkflowExecutionStatus = z.infer<typeof workflowExecutionStatusSchema>;

const workflowEnvelopeFields = {
  storeId: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(200),
  correlationId: z.string().min(1).max(128),
  concurrencyKey: z.string().min(1).max(200),
};

// ============================================================================
// Implemented Workflow Contracts (Task 8)
// ============================================================================

export const catalogSyncWorkflowInputSchema = z
  .object({
    ...workflowEnvelopeFields,
    country: z.string().length(2),
    language: z.string().min(2).max(10),
    currency: z.string().length(3),
    shopifyDomain: z.string().min(3).max(255),
    tokenEnv: z.string().min(1).max(120),
    delegationTicket: z.string().min(16).max(4_096),
    initiateNewSweep: z.boolean().default(false),
    maxPages: z.number().int().min(1).max(250).default(50),
    continuationIndex: z.number().int().min(0).max(50).default(0),
    maxContinuations: z.number().int().min(0).max(50).default(10),
  })
  .strict();
export type CatalogSyncWorkflowInput = z.input<typeof catalogSyncWorkflowInputSchema>;
export type ParsedCatalogSyncWorkflowInput = z.output<typeof catalogSyncWorkflowInputSchema>;

export const catalogSyncWorkflowOutputSchema = z.object({
  status: z.enum(['COMPLETED', 'CONTINUATION_REQUIRED']),
  pagesProcessed: z.number().int().nonnegative(),
  finalSyncStatus: z.string(),
  completedAt: z.string().datetime().nullable(),
  continuationDispatched: z.boolean().default(false),
  nextExecutionId: z.string().uuid().nullable().default(null),
});
export type CatalogSyncWorkflowOutput = z.infer<typeof catalogSyncWorkflowOutputSchema>;

export const embeddingRefreshWorkflowInputSchema = z
  .object({
    ...workflowEnvelopeFields,
    country: z.string().length(2),
    language: z.string().min(2).max(10),
    batchSize: z.number().int().min(1).max(100).default(32),
    maxDocuments: z.number().int().min(1).max(2_000).default(256),
  })
  .strict();
export type EmbeddingRefreshWorkflowInput = z.infer<typeof embeddingRefreshWorkflowInputSchema>;

export const embeddingRefreshWorkflowOutputSchema = z.object({
  status: z.enum(['COMPLETED', 'NOT_CONFIGURED', 'PARTIAL']),
  processed: z.number().int().nonnegative(),
  skippedUnchanged: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
});
export type EmbeddingRefreshWorkflowOutput = z.infer<typeof embeddingRefreshWorkflowOutputSchema>;

export const retentionCleanupWorkflowInputSchema = z
  .object({
    ...workflowEnvelopeFields,
    asOfIso: z.string().datetime().optional(),
  })
  .strict();
export type RetentionCleanupWorkflowInput = z.infer<typeof retentionCleanupWorkflowInputSchema>;

export const retentionCleanupWorkflowOutputSchema = z.object({
  status: z.literal('COMPLETED'),
  experiencePurged: z.record(z.string(), z.number().int().nonnegative()),
  intelligencePurged: z.record(z.string(), z.number().int().nonnegative()),
  executedAt: z.string().datetime(),
});
export type RetentionCleanupWorkflowOutput = z.infer<typeof retentionCleanupWorkflowOutputSchema>;

// ============================================================================
// Typed Future Durable Workflow Contracts (Task 9 — Unimplemented in FL06)
// ============================================================================

export const shopifyWebhookReconciliationInputSchema = z
  .object({
    ...workflowEnvelopeFields,
    webhookInboxId: z.string().uuid(),
    topic: z.string().min(1).max(120),
    shopifyWebhookId: z.string().min(1).max(200),
  })
  .strict();

export const memoryConsolidationInputSchema = z
  .object({
    ...workflowEnvelopeFields,
    customerId: z.string().uuid(),
    sessionId: z.string().uuid(),
    conversationId: z.string().uuid(),
  })
  .strict();

export const customerSegmentationInputSchema = z
  .object({
    ...workflowEnvelopeFields,
    segmentDefinitionVersion: z.string().min(1).max(64),
    dryRun: z.boolean().default(true),
  })
  .strict();

export const campaignPreparationInputSchema = z
  .object({
    ...workflowEnvelopeFields,
    campaignId: z.string().uuid(),
    merchantUserId: z.string().uuid(),
  })
  .strict();

export const campaignDispatchInputSchema = z
  .object({
    ...workflowEnvelopeFields,
    campaignId: z.string().uuid(),
    approvalSignature: z.string().min(16).max(1_024),
    approvedByMerchantUserId: z.string().uuid(),
  })
  .strict();

export const privacyDeletionPropagationInputSchema = z
  .object({
    ...workflowEnvelopeFields,
    privacyRequestId: z.string().uuid(),
    subjectCustomerId: z.string().uuid().nullable(),
    subjectSessionId: z.string().uuid().nullable(),
  })
  .strict();

export const supportCaseProcessingInputSchema = z
  .object({
    ...workflowEnvelopeFields,
    supportCaseId: z.string().uuid(),
    conversationId: z.string().uuid(),
    severity: z.enum(['low', 'normal', 'high']),
  })
  .strict();

export interface WorkflowDefinitionMetadata<TInput extends z.ZodTypeAny = z.ZodTypeAny> {
  name: WorkflowName;
  implemented: boolean;
  implementedIn: 'FL06' | 'FL09' | 'FL10' | 'FL11';
  inputSchema: TInput;
  executionTimeout: `${number}s` | `${number}m`;
  scheduleTimeout: `${number}m`;
  retries: number;
  backoffFactor: number;
  backoffMaxSeconds: number;
  nonIdempotentExternalEffects: boolean;
}

export const WORKFLOW_CONTRACT_REGISTRY: Readonly<Record<WorkflowName, WorkflowDefinitionMetadata>> = {
  'vaarg.catalog.sync': {
    name: 'vaarg.catalog.sync',
    implemented: true,
    implementedIn: 'FL06',
    inputSchema: catalogSyncWorkflowInputSchema,
    executionTimeout: '10m',
    scheduleTimeout: '15m',
    retries: 2,
    backoffFactor: 2,
    backoffMaxSeconds: 60,
    nonIdempotentExternalEffects: false,
  },
  'vaarg.embeddings.refresh': {
    name: 'vaarg.embeddings.refresh',
    implemented: true,
    implementedIn: 'FL06',
    inputSchema: embeddingRefreshWorkflowInputSchema,
    executionTimeout: '5m',
    scheduleTimeout: '15m',
    retries: 2,
    backoffFactor: 2,
    backoffMaxSeconds: 45,
    nonIdempotentExternalEffects: false,
  },
  'vaarg.experience.retention_cleanup': {
    name: 'vaarg.experience.retention_cleanup',
    implemented: true,
    implementedIn: 'FL06',
    inputSchema: retentionCleanupWorkflowInputSchema,
    executionTimeout: '3m',
    scheduleTimeout: '15m',
    retries: 2,
    backoffFactor: 2,
    backoffMaxSeconds: 30,
    nonIdempotentExternalEffects: false,
  },
  'vaarg.shopify.webhook_reconciliation': {
    name: 'vaarg.shopify.webhook_reconciliation',
    implemented: false,
    implementedIn: 'FL09',
    inputSchema: shopifyWebhookReconciliationInputSchema,
    executionTimeout: '2m',
    scheduleTimeout: '10m',
    retries: 3,
    backoffFactor: 2,
    backoffMaxSeconds: 60,
    nonIdempotentExternalEffects: false,
  },
  'vaarg.memory.consolidation': {
    name: 'vaarg.memory.consolidation',
    implemented: false,
    implementedIn: 'FL09',
    inputSchema: memoryConsolidationInputSchema,
    executionTimeout: '2m',
    scheduleTimeout: '10m',
    retries: 2,
    backoffFactor: 2,
    backoffMaxSeconds: 30,
    nonIdempotentExternalEffects: false,
  },
  'vaarg.cdp.customer_segmentation': {
    name: 'vaarg.cdp.customer_segmentation',
    implemented: false,
    implementedIn: 'FL10',
    inputSchema: customerSegmentationInputSchema,
    executionTimeout: '5m',
    scheduleTimeout: '15m',
    retries: 2,
    backoffFactor: 2,
    backoffMaxSeconds: 60,
    nonIdempotentExternalEffects: false,
  },
  'vaarg.marketing.campaign_preparation': {
    name: 'vaarg.marketing.campaign_preparation',
    implemented: false,
    implementedIn: 'FL11',
    inputSchema: campaignPreparationInputSchema,
    executionTimeout: '3m',
    scheduleTimeout: '10m',
    retries: 1,
    backoffFactor: 2,
    backoffMaxSeconds: 30,
    nonIdempotentExternalEffects: false,
  },
  'vaarg.marketing.campaign_dispatch': {
    name: 'vaarg.marketing.campaign_dispatch',
    implemented: false,
    implementedIn: 'FL11',
    inputSchema: campaignDispatchInputSchema,
    executionTimeout: '5m',
    scheduleTimeout: '10m',
    retries: 0, // Never blindly retry non-idempotent external customer messaging!
    backoffFactor: 2,
    backoffMaxSeconds: 30,
    nonIdempotentExternalEffects: true,
  },
  'vaarg.privacy.deletion_propagation': {
    name: 'vaarg.privacy.deletion_propagation',
    implemented: false,
    implementedIn: 'FL09',
    inputSchema: privacyDeletionPropagationInputSchema,
    executionTimeout: '5m',
    scheduleTimeout: '15m',
    retries: 3,
    backoffFactor: 2,
    backoffMaxSeconds: 60,
    nonIdempotentExternalEffects: false,
  },
  'vaarg.support.case_processing': {
    name: 'vaarg.support.case_processing',
    implemented: false,
    implementedIn: 'FL10',
    inputSchema: supportCaseProcessingInputSchema,
    executionTimeout: '2m',
    scheduleTimeout: '10m',
    retries: 2,
    backoffFactor: 2,
    backoffMaxSeconds: 30,
    nonIdempotentExternalEffects: false,
  },
};

export function buildStoreMarketConcurrencyKey(
  storeId: string,
  country: string,
  language: string,
): string {
  return `store:${storeId}:market:${country.toUpperCase()}:${language.toUpperCase()}`;
}

export function buildStoreConcurrencyKey(storeId: string): string {
  return `store:${storeId}`;
}

export interface WorkflowExecutionRecord {
  executionId: string;
  storeId: string;
  workflowName: WorkflowName;
  idempotencyKey: string;
  correlationId: string;
  concurrencyKey: string | null;
  hatchetWorkflowRunId: string | null;
  outboxEventId: string | null;
  status: WorkflowExecutionStatus;
  payloadHash: string;
  resultSummary?: Record<string, unknown> | null;
  attempts: number;
  lastError: string | null;
  submittedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const operatorCatalogSyncRequestSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(200),
    initiateNewSweep: z.boolean().default(false),
    maxPages: z.number().int().min(1).max(250).default(50),
  })
  .strict();
export type OperatorCatalogSyncRequest = z.infer<typeof operatorCatalogSyncRequestSchema>;

export interface WorkflowOrchestrationPort {
  readiness(): { status: 'READY' | 'NOT_CONFIGURED' | 'NOT_READY'; detail: string };
  submitWorkflow<TName extends WorkflowName>(
    workflowName: TName,
    input: z.input<(typeof WORKFLOW_CONTRACT_REGISTRY)[TName]['inputSchema']>,
    options?: { outboxEventId?: string },
  ): Promise<WorkflowExecutionRecord>;
  getWorkflowExecution(storeId: string, executionId: string): Promise<WorkflowExecutionRecord | null>;
  cancelWorkflowExecution(storeId: string, executionId: string): Promise<WorkflowExecutionRecord>;
}
