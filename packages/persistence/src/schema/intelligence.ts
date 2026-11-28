import {
  pgTable,
  uuid,
  varchar,
  text,
  bigint,
  integer,
  boolean,
  numeric,
  jsonb,
  timestamp,
  char,
  primaryKey,
  uniqueIndex,
  index,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { stores, customers } from './identity.js';
import { visitorSessions } from './experience.js';

export const conversations = pgTable(
  'conversations',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    customerId: uuid('customer_id'),
    hermesSessionId: varchar('hermes_session_id', { length: 200 }).notNull(),
    status: text('status').notNull().default('active'),
    messageSeq: bigint('message_seq', { mode: 'number' }).notNull().default(0),
    lastContextVersion: bigint('last_context_version', { mode: 'number' }).notNull().default(0),
    retentionExpiresAt: timestamp('retention_expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ name: 'conversations_pkey', columns: [table.storeId, table.conversationId] }),
    uniqueIndex('conversations_store_hermes_session_uidx').on(table.storeId, table.hermesSessionId),
    foreignKey({
      name: 'conversations_store_session_fk',
      columns: [table.storeId, table.sessionId],
      foreignColumns: [visitorSessions.storeId, visitorSessions.sessionId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'conversations_store_customer_fk',
      columns: [table.storeId, table.customerId],
      foreignColumns: [customers.storeId, customers.customerId],
    }),
    index('conversations_session_status_idx').on(table.storeId, table.sessionId, table.status),
    index('conversations_retention_idx').on(table.storeId, table.retentionExpiresAt),
  ],
);

export const agentPromptVersions = pgTable(
  'agent_prompt_versions',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    promptVersionId: uuid('prompt_version_id').notNull(),
    role: text('role').notNull(),
    version: varchar('version', { length: 64 }).notNull(),
    promptSha256: char('prompt_sha256', { length: 64 }).notNull(),
    templateText: text('template_text').notNull(),
    inputSchemaVersion: varchar('input_schema_version', { length: 32 }).notNull(),
    outputSchemaVersion: varchar('output_schema_version', { length: 32 }).notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'agent_prompt_versions_pkey', columns: [table.storeId, table.promptVersionId] }),
    uniqueIndex('agent_prompt_versions_role_version_uidx').on(table.storeId, table.role, table.version),
  ],
);

export const providerPolicies = pgTable(
  'provider_policies',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    providerPolicyId: uuid('provider_policy_id').notNull(),
    provider: text('provider').notNull(),
    model: varchar('model', { length: 120 }).notNull(),
    permittedRoles: text('permitted_roles').array().notNull(),
    maxContextTokens: integer('max_context_tokens').notNull(),
    maxOutputTokens: integer('max_output_tokens').notNull(),
    timeoutMs: integer('timeout_ms').notNull(),
    inputCostPerMillionUsd: numeric('input_cost_per_million_usd', { precision: 12, scale: 6 }).notNull(),
    outputCostPerMillionUsd: numeric('output_cost_per_million_usd', { precision: 12, scale: 6 }).notNull(),
    cacheReadCostPerMillionUsd: numeric('cache_read_cost_per_million_usd', { precision: 12, scale: 6 })
      .notNull()
      .default('0'),
    cacheWriteCostPerMillionUsd: numeric('cache_write_cost_per_million_usd', { precision: 12, scale: 6 })
      .notNull()
      .default('0'),
    pricingVerified: boolean('pricing_verified').notNull().default(false),
    allowImplicitFallback: boolean('allow_implicit_fallback').notNull().default(false),
    availability: text('availability').notNull().default('not_configured'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'provider_policies_pkey', columns: [table.storeId, table.providerPolicyId] }),
    uniqueIndex('provider_policies_provider_model_uidx').on(table.storeId, table.provider, table.model),
  ],
);

export const agentPolicies = pgTable(
  'agent_policies',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    agentPolicyId: uuid('agent_policy_id').notNull(),
    policyKey: varchar('policy_key', { length: 80 }).notNull(),
    role: text('role').notNull(),
    allowedCapabilities: text('allowed_capabilities').array().notNull(),
    delegationEnabled: boolean('delegation_enabled').notNull().default(false),
    maxConcurrentChildren: integer('max_concurrent_children').notNull().default(3),
    maxDelegationDepth: integer('max_delegation_depth').notNull().default(1),
    maxTotalChildren: integer('max_total_children').notNull().default(6),
    maxTotalTokens: integer('max_total_tokens').notNull(),
    maxModelCalls: integer('max_model_calls').notNull(),
    maxToolCalls: integer('max_tool_calls').notNull(),
    maxCostUsd: numeric('max_cost_usd', { precision: 12, scale: 6 }).notNull(),
    maxDurationMs: integer('max_duration_ms').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'agent_policies_pkey', columns: [table.storeId, table.agentPolicyId] }),
    uniqueIndex('agent_policies_key_role_uidx').on(table.storeId, table.policyKey, table.role),
  ],
);

export const agentRuns = pgTable(
  'agent_runs',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    runId: uuid('run_id').notNull(),
    rootRunId: uuid('root_run_id').notNull(),
    parentRunId: uuid('parent_run_id'),
    conversationId: uuid('conversation_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    customerId: uuid('customer_id'),
    triggerMessageId: uuid('trigger_message_id'),
    role: text('role').notNull(),
    depth: integer('depth').notNull().default(0),
    status: text('status').notNull(),
    terminalReason: varchar('terminal_reason', { length: 120 }),
    hermesRunId: varchar('hermes_run_id', { length: 200 }),
    hermesSessionId: varchar('hermes_session_id', { length: 200 }),
    delegationId: varchar('delegation_id', { length: 200 }),
    provider: text('provider').notNull(),
    model: varchar('model', { length: 120 }).notNull(),
    promptVersion: varchar('prompt_version', { length: 64 }).notNull(),
    policyKey: varchar('policy_key', { length: 80 }).notNull(),
    contextVersion: bigint('context_version', { mode: 'number' }).notNull(),
    publishedExperienceRevision: bigint('published_experience_revision', { mode: 'number' }),
    correlationId: varchar('correlation_id', { length: 128 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }),
    payloadHash: char('payload_hash', { length: 64 }),
    budgetMaxTokens: integer('budget_max_tokens').notNull(),
    budgetMaxModelCalls: integer('budget_max_model_calls').notNull(),
    budgetMaxToolCalls: integer('budget_max_tool_calls').notNull(),
    budgetMaxCostUsd: numeric('budget_max_cost_usd', { precision: 12, scale: 6 }).notNull(),
    budgetMaxConcurrentChildren: integer('budget_max_concurrent_children').notNull().default(3),
    budgetMaxTotalChildren: integer('budget_max_total_children').notNull().default(6),
    reservedTokens: integer('reserved_tokens').notNull().default(0),
    consumedTokens: integer('consumed_tokens').notNull().default(0),
    reservedModelCalls: integer('reserved_model_calls').notNull().default(0),
    consumedModelCalls: integer('consumed_model_calls').notNull().default(0),
    reservedToolCalls: integer('reserved_tool_calls').notNull().default(0),
    consumedToolCalls: integer('consumed_tool_calls').notNull().default(0),
    reservedCostUsd: numeric('reserved_cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    consumedCostUsd: numeric('consumed_cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    activeChildrenCount: integer('active_children_count').notNull().default(0),
    totalChildrenSpawned: integer('total_children_spawned').notNull().default(0),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    redactedTrace: jsonb('redacted_trace').$type<Record<string, unknown>>().notNull().default({}),
    validatedOutput: jsonb('validated_output').$type<Record<string, unknown>>(),
    errorCode: varchar('error_code', { length: 80 }),
    errorMessage: varchar('error_message', { length: 500 }),
    eventSeq: bigint('event_seq', { mode: 'number' }).notNull().default(0),
    retentionExpiresAt: timestamp('retention_expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'agent_runs_pkey', columns: [table.storeId, table.runId] }),
    foreignKey({
      name: 'agent_runs_store_root_fk',
      columns: [table.storeId, table.rootRunId],
      foreignColumns: [table.storeId, table.runId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'agent_runs_store_parent_fk',
      columns: [table.storeId, table.parentRunId],
      foreignColumns: [table.storeId, table.runId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'agent_runs_store_conversation_fk',
      columns: [table.storeId, table.conversationId],
      foreignColumns: [conversations.storeId, conversations.conversationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'agent_runs_store_session_fk',
      columns: [table.storeId, table.sessionId],
      foreignColumns: [visitorSessions.storeId, visitorSessions.sessionId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'agent_runs_store_customer_fk',
      columns: [table.storeId, table.customerId],
      foreignColumns: [customers.storeId, customers.customerId],
    }),
    index('agent_runs_conversation_status_idx').on(table.storeId, table.conversationId, table.status),
    index('agent_runs_root_children_idx').on(table.storeId, table.rootRunId, table.depth, table.status),
  ],
);

export const messages = pgTable(
  'messages',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    messageId: uuid('message_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    runId: uuid('run_id'),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('accepted'),
    content: text('content').notNull(),
    structuredPayload: jsonb('structured_payload').$type<Record<string, unknown>>().notNull().default({}),
    contextVersion: bigint('context_version', { mode: 'number' }).notNull(),
    correlationId: varchar('correlation_id', { length: 128 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }),
    payloadHash: char('payload_hash', { length: 64 }),
    retentionExpiresAt: timestamp('retention_expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'messages_pkey', columns: [table.storeId, table.messageId] }),
    uniqueIndex('messages_conversation_seq_uidx').on(table.storeId, table.conversationId, table.sequence),
    foreignKey({
      name: 'messages_store_conversation_fk',
      columns: [table.storeId, table.conversationId],
      foreignColumns: [conversations.storeId, conversations.conversationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'messages_store_session_fk',
      columns: [table.storeId, table.sessionId],
      foreignColumns: [visitorSessions.storeId, visitorSessions.sessionId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'messages_store_run_fk',
      columns: [table.storeId, table.runId],
      foreignColumns: [agentRuns.storeId, agentRuns.runId],
    }),
  ],
);

export const conversationSummaries = pgTable(
  'conversation_summaries',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    summaryId: uuid('summary_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    coveredUpToSequence: bigint('covered_up_to_sequence', { mode: 'number' }).notNull(),
    summaryText: text('summary_text').notNull(),
    personalizationConsented: boolean('personalization_consented').notNull().default(false),
    provenance: jsonb('provenance').$type<Record<string, unknown>>().notNull().default({}),
    retentionExpiresAt: timestamp('retention_expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'conversation_summaries_pkey', columns: [table.storeId, table.summaryId] }),
    uniqueIndex('conversation_summaries_seq_uidx').on(
      table.storeId,
      table.conversationId,
      table.coveredUpToSequence,
    ),
    foreignKey({
      name: 'conversation_summaries_store_conversation_fk',
      columns: [table.storeId, table.conversationId],
      foreignColumns: [conversations.storeId, conversations.conversationId],
    }).onDelete('cascade'),
  ],
);

export const toolInvocations = pgTable(
  'tool_invocations',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    invocationId: uuid('invocation_id').notNull(),
    runId: uuid('run_id').notNull(),
    rootRunId: uuid('root_run_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    role: text('role').notNull(),
    roleVerified: boolean('role_verified').notNull().default(false),
    capability: varchar('capability', { length: 120 }).notNull(),
    toolCallId: varchar('tool_call_id', { length: 200 }),
    idempotencyKey: varchar('idempotency_key', { length: 200 }),
    payloadHash: char('payload_hash', { length: 64 }),
    correlationId: varchar('correlation_id', { length: 128 }).notNull(),
    status: text('status').notNull(),
    contextVersion: bigint('context_version', { mode: 'number' }).notNull(),
    inputRedacted: jsonb('input_redacted').$type<Record<string, unknown>>().notNull().default({}),
    outputRedacted: jsonb('output_redacted').$type<Record<string, unknown>>(),
    errorCode: varchar('error_code', { length: 80 }),
    errorMessage: varchar('error_message', { length: 500 }),
    durationMs: integer('duration_ms'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    retentionExpiresAt: timestamp('retention_expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ name: 'tool_invocations_pkey', columns: [table.storeId, table.invocationId] }),
    foreignKey({
      name: 'tool_invocations_store_run_fk',
      columns: [table.storeId, table.runId],
      foreignColumns: [agentRuns.storeId, agentRuns.runId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'tool_invocations_store_root_run_fk',
      columns: [table.storeId, table.rootRunId],
      foreignColumns: [agentRuns.storeId, agentRuns.runId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'tool_invocations_store_session_fk',
      columns: [table.storeId, table.sessionId],
      foreignColumns: [visitorSessions.storeId, visitorSessions.sessionId],
    }).onDelete('cascade'),
  ],
);

export const modelUsage = pgTable(
  'model_usage',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    usageId: uuid('usage_id').notNull(),
    runId: uuid('run_id').notNull(),
    rootRunId: uuid('root_run_id').notNull(),
    provider: text('provider').notNull(),
    model: varchar('model', { length: 120 }).notNull(),
    providerRequestId: varchar('provider_request_id', { length: 200 }),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    reservedTokens: integer('reserved_tokens').notNull().default(0),
    reservedCostUsd: numeric('reserved_cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    measuredCostUsd: numeric('measured_cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    reconciled: boolean('reconciled').notNull().default(false),
    latencyMs: integer('latency_ms'),
    routeSource: varchar('route_source', { length: 64 }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    retentionExpiresAt: timestamp('retention_expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ name: 'model_usage_pkey', columns: [table.storeId, table.usageId] }),
    foreignKey({
      name: 'model_usage_store_run_fk',
      columns: [table.storeId, table.runId],
      foreignColumns: [agentRuns.storeId, agentRuns.runId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'model_usage_store_root_run_fk',
      columns: [table.storeId, table.rootRunId],
      foreignColumns: [agentRuns.storeId, agentRuns.runId],
    }).onDelete('cascade'),
  ],
);

export const actionProposals = pgTable(
  'action_proposals',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    proposalId: uuid('proposal_id').notNull(),
    runId: uuid('run_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    customerId: uuid('customer_id'),
    proposedByRole: text('proposed_by_role').notNull(),
    proposalType: text('proposal_type').notNull(),
    status: text('status').notNull().default('proposed'),
    requiresConfirmation: boolean('requires_confirmation').notNull().default(true),
    contextVersion: bigint('context_version', { mode: 'number' }).notNull(),
    appliedExperienceRevision: bigint('applied_experience_revision', { mode: 'number' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    correlationId: varchar('correlation_id', { length: 128 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'action_proposals_pkey', columns: [table.storeId, table.proposalId] }),
    foreignKey({
      name: 'action_proposals_store_run_fk',
      columns: [table.storeId, table.runId],
      foreignColumns: [agentRuns.storeId, agentRuns.runId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'action_proposals_store_conversation_fk',
      columns: [table.storeId, table.conversationId],
      foreignColumns: [conversations.storeId, conversations.conversationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'action_proposals_store_session_fk',
      columns: [table.storeId, table.sessionId],
      foreignColumns: [visitorSessions.storeId, visitorSessions.sessionId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'action_proposals_store_customer_fk',
      columns: [table.storeId, table.customerId],
      foreignColumns: [customers.storeId, customers.customerId],
    }),
  ],
);

export const workflowExecutions = pgTable(
  'workflow_executions',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    executionId: uuid('execution_id').notNull(),
    workflowName: varchar('workflow_name', { length: 120 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    correlationId: varchar('correlation_id', { length: 128 }).notNull(),
    concurrencyKey: varchar('concurrency_key', { length: 200 }),
    hatchetWorkflowRunId: varchar('hatchet_workflow_run_id', { length: 200 }),
    outboxEventId: uuid('outbox_event_id'),
    status: text('status').notNull(),
    payloadHash: char('payload_hash', { length: 64 }).notNull(),
    inputRedacted: jsonb('input_redacted').$type<Record<string, unknown>>().notNull().default({}),
    resultSummary: jsonb('result_summary').$type<Record<string, unknown>>(),
    attempts: integer('attempts').notNull().default(0),
    lastError: varchar('last_error', { length: 500 }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'workflow_executions_pkey', columns: [table.storeId, table.executionId] }),
    uniqueIndex('workflow_executions_name_idempotency_uidx').on(
      table.storeId,
      table.workflowName,
      table.idempotencyKey,
    ),
  ],
);

export const agentRunEvents = pgTable(
  'agent_run_events',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    runId: uuid('run_id').notNull(),
    eventSeq: bigint('event_seq', { mode: 'number' }).notNull(),
    eventId: varchar('event_id', { length: 160 }).notNull(),
    agUiType: varchar('ag_ui_type', { length: 64 }).notNull(),
    sourceKey: varchar('source_key', { length: 160 }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    retentionExpiresAt: timestamp('retention_expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'agent_run_events_pkey',
      columns: [table.storeId, table.runId, table.eventSeq],
    }),
    foreignKey({
      name: 'agent_run_events_store_run_fk',
      columns: [table.storeId, table.runId],
      foreignColumns: [agentRuns.storeId, agentRuns.runId],
    }).onDelete('cascade'),
    index('agent_run_events_retention_idx').on(table.storeId, table.retentionExpiresAt),
  ],
);

