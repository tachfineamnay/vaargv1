import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  AGENT_ROLES,
  AppError,
  MAX_CONCURRENT_CHILDREN_HARD_CAP,
  MAX_DELEGATION_DEPTH_HARD_CAP,
  ROLE_DEFINITIONS,
  actionProposalSchema,
  agentRunRecordSchema,
  conversationMessageSchema,
  conversationSchema,
  conversationSummarySchema,
  isTerminalAgentRunStatus,
  redactSensitiveText,
  redactStructuredRecord,
  structuredMessagePayloadSchema,
  validateSafeAgUiEvent,
  type AGUIEvent,
  type ActionProposal,
  type ActionProposalStatus,
  type ActionProposalType,
  type AgentRole,
  type AgentRunRecord,
  type AgentRunStatus,
  type Conversation,
  type ConversationMessage,
  type ConversationSummary,
  type DirectModelProvider,
  type PersistedAgUiStreamEnvelope,
  type ProviderPolicy,
  type RunBudgetPolicy,
  type StructuredMessagePayload,
  type ToolInvocationStatus,
} from '@vaarg/shared';
import { scopedStoreTransaction } from '../commerce/scope.js';

const DEFAULT_CONVERSATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_RUN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_PROPOSAL_TTL_MS = 60 * 60 * 1000;

export function hashPayloadSha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function isoDate(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return new Date(val).toISOString();
  return new Date().toISOString();
}

function nullableIsoDate(val: unknown): string | null {
  if (!val) return null;
  return isoDate(val);
}

async function assertActiveSessionOwnership(
  client: PoolClient,
  storeId: string,
  sessionId: string,
): Promise<{ sessionId: string; customerId: string | null }> {
  const { rows } = await client.query<{
    session_id: string;
    customer_id: string | null;
    status: string;
    expires_at: Date;
  }>(
    `SELECT session_id, customer_id, status, expires_at
       FROM visitor_sessions
      WHERE store_id = $1 AND session_id = $2
      LIMIT 1`,
    [storeId, sessionId],
  );
  const row = rows[0];
  if (!row || row.status !== 'active' || new Date(row.expires_at).getTime() <= Date.now()) {
    throw AppError.unauthorized('Visitor session is missing, revoked, or expired');
  }
  return { sessionId: row.session_id, customerId: row.customer_id };
}

function mapConversationRow(row: Record<string, unknown>): Conversation {
  return conversationSchema.parse({
    conversationId: String(row.conversation_id),
    storeId: String(row.store_id),
    sessionId: String(row.session_id),
    customerId: row.customer_id ? String(row.customer_id) : null,
    hermesSessionId: String(row.hermes_session_id),
    status: String(row.status),
    messageSeq: Number(row.message_seq),
    lastContextVersion: Number(row.last_context_version),
    retentionExpiresAt: isoDate(row.retention_expires_at),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
    closedAt: nullableIsoDate(row.closed_at),
  });
}

function mapMessageRow(row: Record<string, unknown>): ConversationMessage {
  return conversationMessageSchema.parse({
    messageId: String(row.message_id),
    storeId: String(row.store_id),
    conversationId: String(row.conversation_id),
    sessionId: String(row.session_id),
    runId: row.run_id ? String(row.run_id) : null,
    sequence: Number(row.sequence),
    role: String(row.role),
    status: String(row.status),
    content: String(row.content),
    structuredPayload: structuredMessagePayloadSchema.parse(row.structured_payload ?? {}),
    contextVersion: Number(row.context_version),
    correlationId: String(row.correlation_id),
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
    createdAt: isoDate(row.created_at),
  });
}

function mapAgentRunRow(row: Record<string, unknown>): AgentRunRecord {
  return agentRunRecordSchema.parse({
    runId: String(row.run_id),
    rootRunId: String(row.root_run_id),
    parentRunId: row.parent_run_id ? String(row.parent_run_id) : null,
    storeId: String(row.store_id),
    conversationId: String(row.conversation_id),
    sessionId: String(row.session_id),
    customerId: row.customer_id ? String(row.customer_id) : null,
    triggerMessageId: row.trigger_message_id ? String(row.trigger_message_id) : null,
    role: String(row.role),
    depth: Number(row.depth) as 0 | 1,
    status: String(row.status),
    terminalReason: row.terminal_reason ? String(row.terminal_reason) : null,
    hermesRunId: row.hermes_run_id ? String(row.hermes_run_id) : null,
    hermesSessionId: row.hermes_session_id ? String(row.hermes_session_id) : null,
    delegationId: row.delegation_id ? String(row.delegation_id) : null,
    provider: String(row.provider),
    model: String(row.model),
    promptVersion: String(row.prompt_version),
    policyKey: String(row.policy_key),
    contextVersion: Number(row.context_version),
    publishedExperienceRevision:
      row.published_experience_revision !== null && row.published_experience_revision !== undefined
        ? Number(row.published_experience_revision)
        : null,
    correlationId: String(row.correlation_id),
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
    budget: {
      maxTokens: Number(row.budget_max_tokens),
      maxModelCalls: Number(row.budget_max_model_calls),
      maxToolCalls: Number(row.budget_max_tool_calls),
      maxCostUsd: Number(row.budget_max_cost_usd),
      maxConcurrentChildren: Number(row.budget_max_concurrent_children),
      maxTotalChildren: Number(row.budget_max_total_children),
      reservedTokens: Number(row.reserved_tokens),
      consumedTokens: Number(row.consumed_tokens),
      reservedModelCalls: Number(row.reserved_model_calls),
      consumedModelCalls: Number(row.consumed_model_calls),
      reservedToolCalls: Number(row.reserved_tool_calls),
      consumedToolCalls: Number(row.consumed_tool_calls),
      reservedCostUsd: Number(row.reserved_cost_usd),
      consumedCostUsd: Number(row.consumed_cost_usd),
      activeChildrenCount: Number(row.active_children_count),
      totalChildrenSpawned: Number(row.total_children_spawned),
      deadlineAt: isoDate(row.deadline_at),
    },
    cancelRequestedAt: nullableIsoDate(row.cancel_requested_at),
    startedAt: nullableIsoDate(row.started_at),
    completedAt: nullableIsoDate(row.completed_at),
    redactedTrace: (row.redacted_trace as Record<string, unknown>) ?? {},
    validatedOutput: (row.validated_output as Record<string, unknown> | null) ?? null,
    errorCode: row.error_code ? String(row.error_code) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  });
}

function mapActionProposalRow(row: Record<string, unknown>): ActionProposal {
  return actionProposalSchema.parse({
    proposalId: String(row.proposal_id),
    storeId: String(row.store_id),
    runId: String(row.run_id),
    conversationId: String(row.conversation_id),
    sessionId: String(row.session_id),
    customerId: row.customer_id ? String(row.customer_id) : null,
    proposedByRole: String(row.proposed_by_role),
    proposalType: String(row.proposal_type),
    status: String(row.status),
    requiresConfirmation: Boolean(row.requires_confirmation),
    contextVersion: Number(row.context_version),
    appliedExperienceRevision:
      row.applied_experience_revision !== null && row.applied_experience_revision !== undefined
        ? Number(row.applied_experience_revision)
        : null,
    payload: (row.payload as Record<string, unknown>) ?? {},
    correlationId: String(row.correlation_id),
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
    expiresAt: isoDate(row.expires_at),
    resolvedAt: nullableIsoDate(row.resolved_at),
    createdAt: isoDate(row.created_at),
    updatedAt: isoDate(row.updated_at),
  });
}

export async function syncRoleDefinitionsAndProviderPolicies(
  pool: Pool,
  storeId: string,
  providerPolicies: readonly ProviderPolicy[],
): Promise<void> {
  await scopedStoreTransaction(pool, storeId, async (client) => {
    for (const role of AGENT_ROLES) {
      const def = ROLE_DEFINITIONS[role];
      await client.query(
        `INSERT INTO agent_prompt_versions (
           store_id, prompt_version_id, role, version, prompt_sha256,
           template_text, input_schema_version, output_schema_version, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
         ON CONFLICT (store_id, role, version) DO UPDATE
           SET prompt_sha256 = EXCLUDED.prompt_sha256,
               template_text = EXCLUDED.template_text`,
        [
          storeId,
          randomUUID(),
          def.role,
          def.version,
          def.promptSha256,
          def.templateText,
          def.inputSchemaVersion,
          def.outputSchemaVersion,
        ],
      );

      const bp = def.defaultBudgetPolicy;
      await client.query(
        `INSERT INTO agent_policies (
           store_id, agent_policy_id, policy_key, role, allowed_capabilities,
           delegation_enabled, max_concurrent_children, max_delegation_depth,
           max_total_children, max_total_tokens, max_model_calls, max_tool_calls,
           max_cost_usd, max_duration_ms, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'active')
         ON CONFLICT (store_id, policy_key, role) DO UPDATE
           SET allowed_capabilities = EXCLUDED.allowed_capabilities,
               updated_at = now()`,
        [
          storeId,
          randomUUID(),
          bp.policyKey,
          bp.role,
          bp.allowedCapabilities,
          bp.delegationEnabled,
          bp.maxConcurrentChildren,
          bp.maxDelegationDepth,
          bp.maxTotalChildren,
          bp.maxTotalTokens,
          bp.maxModelCalls,
          bp.maxToolCalls,
          bp.maxCostUsd,
          bp.maxDurationMs,
        ],
      );
    }

    for (const p of providerPolicies) {
      await client.query(
        `INSERT INTO provider_policies (
           store_id, provider_policy_id, provider, model, permitted_roles,
           max_context_tokens, max_output_tokens, timeout_ms,
           input_cost_per_million_usd, output_cost_per_million_usd,
           cache_read_cost_per_million_usd, cache_write_cost_per_million_usd,
           pricing_verified, allow_implicit_fallback, availability
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, false, $14)
         ON CONFLICT (store_id, provider, model) DO UPDATE
           SET permitted_roles = EXCLUDED.permitted_roles,
               max_context_tokens = EXCLUDED.max_context_tokens,
               max_output_tokens = EXCLUDED.max_output_tokens,
               timeout_ms = EXCLUDED.timeout_ms,
               input_cost_per_million_usd = EXCLUDED.input_cost_per_million_usd,
               output_cost_per_million_usd = EXCLUDED.output_cost_per_million_usd,
               cache_read_cost_per_million_usd = EXCLUDED.cache_read_cost_per_million_usd,
               cache_write_cost_per_million_usd = EXCLUDED.cache_write_cost_per_million_usd,
               pricing_verified = EXCLUDED.pricing_verified,
               availability = EXCLUDED.availability,
               updated_at = now()`,
        [
          storeId,
          randomUUID(),
          p.provider,
          p.model,
          p.permittedRoles,
          p.maxContextTokens,
          p.maxOutputTokens,
          p.timeoutMs,
          p.pricing.inputCostPerMillionUsd,
          p.pricing.outputCostPerMillionUsd,
          p.pricing.cacheReadCostPerMillionUsd,
          p.pricing.cacheWriteCostPerMillionUsd,
          p.pricing.verified,
          p.availability,
        ],
      );
    }
  });
}

export async function createConversationRecord(
  pool: Pool,
  params: {
    storeId: string;
    sessionId: string;
    contextVersion: number;
    retentionTtlMs?: number;
  },
): Promise<Conversation> {
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const verifiedSession = await assertActiveSessionOwnership(
      client,
      params.storeId,
      params.sessionId,
    );
    const conversationId = randomUUID();
    // Isolated Hermes session ID per visitor conversation — never shared across visitors/stores
    const hermesSessionId = `vaarg_${params.storeId.replace(/-/g, '').slice(0, 12)}_${conversationId.replace(/-/g, '')}`;
    const retentionExpiresAt = new Date(
      Date.now() + (params.retentionTtlMs ?? DEFAULT_CONVERSATION_TTL_MS),
    );

    const { rows } = await client.query(
      `INSERT INTO conversations (
         store_id, conversation_id, session_id, customer_id, hermes_session_id,
         status, message_seq, last_context_version, retention_expires_at
       ) VALUES ($1, $2, $3, $4, $5, 'active', 0, $6, $7)
       RETURNING *`,
      [
        params.storeId,
        conversationId,
        verifiedSession.sessionId,
        verifiedSession.customerId,
        hermesSessionId,
        params.contextVersion,
        retentionExpiresAt,
      ],
    );
    return mapConversationRow(rows[0] as Record<string, unknown>);
  });
}

export async function getConversationWithBoundedHistory(
  pool: Pool,
  params: {
    storeId: string;
    sessionId: string;
    conversationId: string;
    personalizationGranted: boolean;
    maxMessages?: number;
  },
): Promise<{
  conversation: Conversation;
  messages: ConversationMessage[];
  summary: ConversationSummary | null;
}> {
  const maxMessages = Math.min(50, Math.max(1, params.maxMessages ?? 20));
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const verifiedSession = await assertActiveSessionOwnership(
      client,
      params.storeId,
      params.sessionId,
    );
    const convRes = await client.query(
      `SELECT * FROM conversations
        WHERE store_id = $1 AND conversation_id = $2
        LIMIT 1`,
      [params.storeId, params.conversationId],
    );
    const convRow = convRes.rows[0] as Record<string, unknown> | undefined;
    if (!convRow) {
      throw AppError.notFound('Conversation not found');
    }
    const conversation = mapConversationRow(convRow);
    const ownsBySession = conversation.sessionId === verifiedSession.sessionId;
    const ownsByCustomer = Boolean(
      verifiedSession.customerId &&
        conversation.customerId &&
        verifiedSession.customerId === conversation.customerId,
    );
    if (!ownsBySession && !ownsByCustomer) {
      // Return 404 to avoid cross-visitor conversation enumeration
      throw AppError.notFound('Conversation not found');
    }
    if (conversation.status === 'deleted' || conversation.status === 'expired') {
      throw AppError.notFound('Conversation is no longer available');
    }

    const msgRes = await client.query(
      `SELECT * FROM (
         SELECT * FROM messages
          WHERE store_id = $1
            AND conversation_id = $2
            AND status = 'accepted'
          ORDER BY sequence DESC
          LIMIT $3
       ) sub
       ORDER BY sequence ASC`,
      [params.storeId, params.conversationId, maxMessages],
    );

    const sumRes = await client.query(
      `SELECT * FROM conversation_summaries
        WHERE store_id = $1
          AND conversation_id = $2
          AND ($3::boolean = true OR personalization_consented = false)
        ORDER BY covered_up_to_sequence DESC
        LIMIT 1`,
      [params.storeId, params.conversationId, params.personalizationGranted],
    );
    const sumRow = sumRes.rows[0] as Record<string, unknown> | undefined;

    return {
      conversation,
      messages: msgRes.rows.map((r) => mapMessageRow(r as Record<string, unknown>)),
      summary: sumRow
        ? conversationSummarySchema.parse({
            summaryId: String(sumRow.summary_id),
            storeId: String(sumRow.store_id),
            conversationId: String(sumRow.conversation_id),
            coveredUpToSequence: Number(sumRow.covered_up_to_sequence),
            summaryText: String(sumRow.summary_text),
            personalizationConsented: Boolean(sumRow.personalization_consented),
            provenance: (sumRow.provenance as Record<string, unknown>) ?? {},
            retentionExpiresAt: isoDate(sumRow.retention_expires_at),
            createdAt: isoDate(sumRow.created_at),
          })
        : null,
    };
  });
}

export async function appendUserConversationMessage(
  pool: Pool,
  params: {
    storeId: string;
    sessionId: string;
    conversationId: string;
    content: string;
    contextVersion: number;
    correlationId: string;
    idempotencyKey?: string;
  },
): Promise<{ message: ConversationMessage; replayed: boolean }> {
  const sanitized = redactSensitiveText(params.content, 4_000);
  if (!sanitized) {
    throw AppError.badRequest('Message content cannot be empty after sanitization');
  }
  const payloadHash = hashPayloadSha256({ content: sanitized });

  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const verifiedSession = await assertActiveSessionOwnership(
      client,
      params.storeId,
      params.sessionId,
    );
    const convRes = await client.query(
      `SELECT * FROM conversations
        WHERE store_id = $1 AND conversation_id = $2
        FOR UPDATE`,
      [params.storeId, params.conversationId],
    );
    const convRow = convRes.rows[0] as Record<string, unknown> | undefined;
    if (!convRow) {
      throw AppError.notFound('Conversation not found');
    }
    const conv = mapConversationRow(convRow);
    if (conv.sessionId !== verifiedSession.sessionId) {
      throw AppError.notFound('Conversation not found');
    }
    if (conv.status !== 'active') {
      throw AppError.conflict(`Conversation is ${conv.status}`);
    }

    if (params.idempotencyKey) {
      const existing = await client.query(
        `SELECT * FROM messages
          WHERE store_id = $1 AND conversation_id = $2 AND idempotency_key = $3
          LIMIT 1`,
        [params.storeId, params.conversationId, params.idempotencyKey],
      );
      const existingRow = existing.rows[0] as Record<string, unknown> | undefined;
      if (existingRow) {
        if (existingRow.payload_hash && String(existingRow.payload_hash) !== payloadHash) {
          throw AppError.conflict('IDEMPOTENCY_KEY_CONFLICT: Message content differs from original request');
        }
        return { message: mapMessageRow(existingRow), replayed: true };
      }
    }

    const nextSeq = conv.messageSeq + 1;
    const retentionExpiresAt = new Date(Date.now() + DEFAULT_CONVERSATION_TTL_MS);
    await client.query(
      `UPDATE conversations
          SET message_seq = $3,
              last_context_version = GREATEST(last_context_version, $4),
              updated_at = now()
        WHERE store_id = $1 AND conversation_id = $2`,
      [params.storeId, params.conversationId, nextSeq, params.contextVersion],
    );

    const inserted = await client.query(
      `INSERT INTO messages (
         store_id, message_id, conversation_id, session_id, run_id,
         sequence, role, status, content, structured_payload,
         context_version, correlation_id, idempotency_key, payload_hash, retention_expires_at
       ) VALUES ($1, $2, $3, $4, NULL, $5, 'user', 'accepted', $6, $7::jsonb, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        params.storeId,
        randomUUID(),
        params.conversationId,
        verifiedSession.sessionId,
        nextSeq,
        sanitized,
        JSON.stringify(structuredMessagePayloadSchema.parse({})),
        params.contextVersion,
        params.correlationId,
        params.idempotencyKey ?? null,
        payloadHash,
        retentionExpiresAt,
      ],
    );
    return {
      message: mapMessageRow(inserted.rows[0] as Record<string, unknown>),
      replayed: false,
    };
  });
}

export async function supersedeActiveConversationRuns(
  pool: Pool,
  params: {
    storeId: string;
    conversationId: string;
    excludeRunId?: string;
  },
): Promise<Array<{ runId: string; hermesRunId: string | null }>> {
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const { rows } = await client.query<{ run_id: string; hermes_run_id: string | null }>(
      `UPDATE agent_runs
          SET status = 'superseded',
              terminal_reason = 'superseded_by_newer_turn',
              completed_at = COALESCE(completed_at, now()),
              active_children_count = 0,
              updated_at = now()
        WHERE store_id = $1
          AND conversation_id = $2
          AND status IN ('queued', 'running', 'cancelling')
          AND ($3::uuid IS NULL OR root_run_id <> $3)
        RETURNING run_id, hermes_run_id`,
      [params.storeId, params.conversationId, params.excludeRunId ?? null],
    );

    if (rows.length > 0) {
      const supersededIds = rows.map((r) => r.run_id);
      await client.query(
        `UPDATE action_proposals
            SET status = 'superseded',
                resolved_at = now(),
                updated_at = now()
          WHERE store_id = $1
            AND run_id = ANY($2::uuid[])
            AND status IN ('proposed', 'pending_confirmation')`,
        [params.storeId, supersededIds],
      );
    }

    return rows.map((r) => ({ runId: r.run_id, hermesRunId: r.hermes_run_id }));
  });
}

export async function createMasterAgentRunRecord(
  pool: Pool,
  params: {
    storeId: string;
    sessionId: string;
    conversationId: string;
    triggerMessageId: string | null;
    provider: DirectModelProvider;
    model: string;
    promptVersion: string;
    budgetPolicy: RunBudgetPolicy;
    contextVersion: number;
    correlationId: string;
    idempotencyKey?: string;
    payloadForHash: Record<string, unknown>;
  },
): Promise<{ run: AgentRunRecord; replayed: boolean }> {
  const payloadHash = hashPayloadSha256(params.payloadForHash);

  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const verifiedSession = await assertActiveSessionOwnership(
      client,
      params.storeId,
      params.sessionId,
    );

    if (params.idempotencyKey) {
      const existing = await client.query(
        `SELECT * FROM agent_runs
          WHERE store_id = $1 AND session_id = $2 AND idempotency_key = $3
          LIMIT 1`,
        [params.storeId, verifiedSession.sessionId, params.idempotencyKey],
      );
      const existingRow = existing.rows[0] as Record<string, unknown> | undefined;
      if (existingRow) {
        if (existingRow.payload_hash && String(existingRow.payload_hash) !== payloadHash) {
          throw AppError.conflict('IDEMPOTENCY_KEY_CONFLICT: Run parameters differ from original request');
        }
        return { run: mapAgentRunRow(existingRow), replayed: true };
      }
    }

    const convRes = await client.query(
      `SELECT * FROM conversations
        WHERE store_id = $1 AND conversation_id = $2
        LIMIT 1`,
      [params.storeId, params.conversationId],
    );
    const convRow = convRes.rows[0] as Record<string, unknown> | undefined;
    if (!convRow || String(convRow.session_id) !== verifiedSession.sessionId) {
      throw AppError.notFound('Conversation not found');
    }
    const hermesSessionId = String(convRow.hermes_session_id);

    const runId = randomUUID();
    const bp = params.budgetPolicy;
    const deadlineAt = new Date(Date.now() + bp.maxDurationMs);
    const retentionExpiresAt = new Date(Date.now() + DEFAULT_RUN_TTL_MS);

    const inserted = await client.query(
      `INSERT INTO agent_runs (
         store_id, run_id, root_run_id, parent_run_id, conversation_id, session_id,
         customer_id, trigger_message_id, role, depth, status, hermes_session_id,
         provider, model, prompt_version, policy_key, context_version,
         correlation_id, idempotency_key, payload_hash,
         budget_max_tokens, budget_max_model_calls, budget_max_tool_calls,
         budget_max_cost_usd, budget_max_concurrent_children, budget_max_total_children,
         deadline_at, started_at, retention_expires_at
       ) VALUES (
         $1, $2, $2, NULL, $3, $4,
         $5, $6, 'master', 0, 'queued', $7,
         $8, $9, $10, $11, $12,
         $13, $14, $15,
         $16, $17, $18,
         $19, $20, $21,
         $22, now(), $23
       )
       RETURNING *`,
      [
        params.storeId,
        runId,
        params.conversationId,
        verifiedSession.sessionId,
        verifiedSession.customerId,
        params.triggerMessageId,
        hermesSessionId,
        params.provider,
        params.model,
        params.promptVersion,
        bp.policyKey,
        params.contextVersion,
        params.correlationId,
        params.idempotencyKey ?? null,
        payloadHash,
        bp.maxTotalTokens,
        bp.maxModelCalls,
        bp.maxToolCalls,
        bp.maxCostUsd,
        Math.min(MAX_CONCURRENT_CHILDREN_HARD_CAP, bp.maxConcurrentChildren),
        bp.maxTotalChildren,
        deadlineAt,
        retentionExpiresAt,
      ],
    );

    return {
      run: mapAgentRunRow(inserted.rows[0] as Record<string, unknown>),
      replayed: false,
    };
  });
}

export async function bindExternalHermesRunId(
  pool: Pool,
  params: {
    storeId: string;
    runId: string;
    hermesRunId: string;
    status: 'queued' | 'running';
  },
): Promise<AgentRunRecord> {
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const { rows } = await client.query(
      `UPDATE agent_runs
          SET hermes_run_id = $3,
              status = CASE WHEN status IN ('queued', 'running') THEN $4 ELSE status END,
              updated_at = now()
        WHERE store_id = $1 AND run_id = $2
        RETURNING *`,
      [params.storeId, params.runId, params.hermesRunId, params.status],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) throw AppError.notFound('Agent run not found');
    return mapAgentRunRow(row);
  });
}

export async function getOwnedAgentRun(
  pool: Pool,
  params: { storeId: string; sessionId: string; runId: string },
): Promise<AgentRunRecord> {
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const verifiedSession = await assertActiveSessionOwnership(
      client,
      params.storeId,
      params.sessionId,
    );
    const { rows } = await client.query(
      `SELECT * FROM agent_runs
        WHERE store_id = $1 AND run_id = $2
        LIMIT 1`,
      [params.storeId, params.runId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row || String(row.session_id) !== verifiedSession.sessionId) {
      throw AppError.notFound('Agent run not found');
    }
    return mapAgentRunRow(row);
  });
}

export async function resolveRunIdentityForHermesSession(
  pool: Pool,
  params: {
    storeId: string;
    rootRunId: string;
    hermesSessionId: string;
    preventiveHooksVerified: boolean;
  },
): Promise<{
  run: AgentRunRecord;
  rootRun: AgentRunRecord;
  roleVerified: boolean;
}> {
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM agent_runs
        WHERE store_id = $1
          AND root_run_id = $2
          AND (run_id = $2 OR hermes_session_id = $3)
        ORDER BY depth DESC`,
      [params.storeId, params.rootRunId, params.hermesSessionId],
    );
    if (rows.length === 0) {
      throw AppError.unauthorized('RUN_IDENTITY_NOT_FOUND: Unknown run or Hermes session');
    }
    const rootRow = rows.find((r) => String(r.run_id) === params.rootRunId) as
      | Record<string, unknown>
      | undefined;
    if (!rootRow) {
      throw AppError.unauthorized('ROOT_RUN_NOT_FOUND');
    }
    const rootRun = mapAgentRunRow(rootRow);

    const exactSessionRow = rows.find(
      (r) => String(r.hermes_session_id ?? '') === params.hermesSessionId,
    ) as Record<string, unknown> | undefined;

    if (exactSessionRow) {
      const matched = mapAgentRunRow(exactSessionRow);
      // Master's own session is only roleVerified if children cannot masquerade on the same
      // session or if preventive subagent hooks track distinct child sessions.
      const roleVerified =
        matched.depth === 1
          ? params.preventiveHooksVerified
          : params.preventiveHooksVerified || rootRun.budget.totalChildrenSpawned === 0;
      return { run: matched, rootRun, roleVerified };
    }

    // Unregistered child session sharing parent bridge ticket -> roleVerified = false!
    // ToolBroker will restrict it to SAFE_READ_CAPABILITY_INTERSECTION.
    return {
      run: rootRun,
      rootRun,
      roleVerified: false,
    };
  });
}

// ============================================================================
// Shared Atomic Parent + Child Budget & Delegation Enforcement (Task 4)
// ============================================================================

async function lockAndCheckRootBudget(
  client: PoolClient,
  storeId: string,
  rootRunId: string,
): Promise<AgentRunRecord> {
  const { rows } = await client.query(
    `SELECT * FROM agent_runs
      WHERE store_id = $1 AND run_id = $2
      FOR UPDATE`,
    [storeId, rootRunId],
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    throw AppError.notFound('Root agent run not found');
  }
  const root = mapAgentRunRow(row);

  if (root.cancelRequestedAt || root.status === 'cancelling' || root.status === 'cancelled') {
    throw AppError.conflict('RUN_CANCELLED: Agent run has been cancelled');
  }
  if (root.status === 'superseded') {
    throw AppError.conflict('RUN_SUPERSEDED: Agent run has been superseded by newer visitor context');
  }
  if (isTerminalAgentRunStatus(root.status)) {
    throw AppError.conflict(`RUN_TERMINAL: Agent run is already in terminal state "${root.status}"`);
  }

  if (new Date(root.budget.deadlineAt).getTime() <= Date.now()) {
    await client.query(
      `UPDATE agent_runs
          SET status = 'timed_out',
              terminal_reason = 'deadline_exceeded',
              completed_at = COALESCE(completed_at, now()),
              active_children_count = 0,
              updated_at = now()
        WHERE store_id = $1 AND root_run_id = $2
          AND status IN ('queued', 'running', 'cancelling')`,
      [storeId, rootRunId],
    );
    throw AppError.unavailable('RUN_DEADLINE_EXCEEDED: Execution deadline reached');
  }

  return root;
}

async function markRootTreeBudgetExceeded(
  client: PoolClient,
  storeId: string,
  rootRunId: string,
  reason: string,
): Promise<void> {
  await client.query(
    `UPDATE agent_runs
        SET status = 'budget_exceeded',
            terminal_reason = $3,
            error_code = 'BUDGET_EXCEEDED',
            error_message = $3,
            completed_at = COALESCE(completed_at, now()),
            active_children_count = 0,
            updated_at = now()
      WHERE store_id = $1 AND root_run_id = $2
        AND status IN ('queued', 'running', 'cancelling')`,
    [storeId, rootRunId, reason.slice(0, 120)],
  );
  await client.query(
    `UPDATE action_proposals
        SET status = 'cancelled',
            resolved_at = now(),
            updated_at = now()
      WHERE store_id = $1
        AND run_id IN (SELECT run_id FROM agent_runs WHERE store_id = $1 AND root_run_id = $2)
        AND status IN ('proposed', 'pending_confirmation')`,
    [storeId, rootRunId],
  );
}

export async function reserveModelCallBudget(
  pool: Pool,
  params: {
    storeId: string;
    rootRunId: string;
    runId: string;
    provider: DirectModelProvider;
    model: string;
    reservedTokens: number;
    reservedCostUsd: number;
  },
): Promise<{ reservationId: string }> {
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const root = await lockAndCheckRootBudget(client, params.storeId, params.rootRunId);
    const b = root.budget;

    const nextModelCalls = b.consumedModelCalls + b.reservedModelCalls + 1;
    if (nextModelCalls > b.maxModelCalls) {
      await markRootTreeBudgetExceeded(client, params.storeId, params.rootRunId, 'max_model_calls_exceeded');
      throw AppError.forbidden(
        `BUDGET_EXCEEDED: Model call limit (${b.maxModelCalls}) exceeded across parent and child runs`,
      );
    }

    const nextTokens = b.consumedTokens + b.reservedTokens + params.reservedTokens;
    if (nextTokens > b.maxTokens) {
      await markRootTreeBudgetExceeded(client, params.storeId, params.rootRunId, 'max_tokens_exceeded');
      throw AppError.forbidden(
        `BUDGET_EXCEEDED: Token budget (${b.maxTokens}) exceeded across parent and child runs`,
      );
    }

    const nextCost = Number((b.consumedCostUsd + b.reservedCostUsd + params.reservedCostUsd).toFixed(6));
    if (nextCost > b.maxCostUsd) {
      await markRootTreeBudgetExceeded(client, params.storeId, params.rootRunId, 'max_cost_usd_exceeded');
      throw AppError.forbidden(
        `BUDGET_EXCEEDED: Monetary budget ($${b.maxCostUsd.toFixed(4)}) exceeded across parent and child runs`,
      );
    }

    await client.query(
      `UPDATE agent_runs
          SET reserved_model_calls = reserved_model_calls + 1,
              reserved_tokens = reserved_tokens + $3,
              reserved_cost_usd = reserved_cost_usd + $4,
              updated_at = now()
        WHERE store_id = $1 AND run_id = $2`,
      [params.storeId, params.rootRunId, params.reservedTokens, params.reservedCostUsd],
    );

    const reservationId = randomUUID();
    await client.query(
      `INSERT INTO model_usage (
         store_id, usage_id, run_id, root_run_id, provider, model,
         reserved_tokens, reserved_cost_usd, measured_cost_usd, reconciled, retention_expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, false, $9)`,
      [
        params.storeId,
        reservationId,
        params.runId,
        params.rootRunId,
        params.provider,
        params.model,
        params.reservedTokens,
        params.reservedCostUsd,
        new Date(Date.now() + DEFAULT_RUN_TTL_MS),
      ],
    );

    return { reservationId };
  });
}

export async function reconcileModelCallUsage(
  pool: Pool,
  params: {
    storeId: string;
    rootRunId: string;
    runId: string;
    reservationId?: string;
    provider: DirectModelProvider;
    model: string;
    providerRequestId?: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    measuredCostUsd: number;
    latencyMs?: number;
    routeSource?: string;
  },
): Promise<{ budgetExceeded: boolean }> {
  const totalTokens = Math.max(0, params.inputTokens) + Math.max(0, params.outputTokens);

  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const { rows: rootRows } = await client.query(
      `SELECT * FROM agent_runs WHERE store_id = $1 AND run_id = $2 FOR UPDATE`,
      [params.storeId, params.rootRunId],
    );
    const rootRow = rootRows[0] as Record<string, unknown> | undefined;
    if (!rootRow) throw AppError.notFound('Root run not found');

    let releasedTokens = 0;
    let releasedCost = 0;
    let releasedCalls = 0;

    if (params.reservationId) {
      const { rows: resRows } = await client.query<{
        reserved_tokens: number;
        reserved_cost_usd: string;
        reconciled: boolean;
      }>(
        `SELECT reserved_tokens, reserved_cost_usd, reconciled
           FROM model_usage
          WHERE store_id = $1 AND usage_id = $2
          FOR UPDATE`,
        [params.storeId, params.reservationId],
      );
      const resRow = resRows[0];
      if (resRow && !resRow.reconciled) {
        releasedTokens = Number(resRow.reserved_tokens);
        releasedCost = Number(resRow.reserved_cost_usd);
        releasedCalls = 1;
        await client.query(
          `UPDATE model_usage
              SET provider_request_id = $3,
                  input_tokens = $4,
                  output_tokens = $5,
                  total_tokens = $6,
                  cache_read_tokens = $7,
                  cache_write_tokens = $8,
                  measured_cost_usd = $9,
                  reconciled = true,
                  latency_ms = $10,
                  route_source = $11,
                  recorded_at = now()
            WHERE store_id = $1 AND usage_id = $2`,
          [
            params.storeId,
            params.reservationId,
            params.providerRequestId ?? null,
            params.inputTokens,
            params.outputTokens,
            totalTokens,
            params.cacheReadTokens ?? 0,
            params.cacheWriteTokens ?? 0,
            params.measuredCostUsd,
            params.latencyMs ?? null,
            params.routeSource ?? null,
          ],
        );
      }
    } else {
      await client.query(
        `INSERT INTO model_usage (
           store_id, usage_id, run_id, root_run_id, provider, model, provider_request_id,
           input_tokens, output_tokens, total_tokens, cache_read_tokens, cache_write_tokens,
           reserved_tokens, reserved_cost_usd, measured_cost_usd, reconciled,
           latency_ms, route_source, retention_expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, 0, $13, true, $14, $15, $16)`,
        [
          params.storeId,
          randomUUID(),
          params.runId,
          params.rootRunId,
          params.provider,
          params.model,
          params.providerRequestId ?? null,
          params.inputTokens,
          params.outputTokens,
          totalTokens,
          params.cacheReadTokens ?? 0,
          params.cacheWriteTokens ?? 0,
          params.measuredCostUsd,
          params.latencyMs ?? null,
          params.routeSource ?? null,
          new Date(Date.now() + DEFAULT_RUN_TTL_MS),
        ],
      );
    }

    const updated = await client.query(
      `UPDATE agent_runs
          SET reserved_model_calls = GREATEST(0, reserved_model_calls - $3),
              reserved_tokens = GREATEST(0, reserved_tokens - $4),
              reserved_cost_usd = GREATEST(0, reserved_cost_usd - $5),
              consumed_model_calls = consumed_model_calls + 1,
              consumed_tokens = consumed_tokens + $6,
              consumed_cost_usd = consumed_cost_usd + $7,
              updated_at = now()
        WHERE store_id = $1 AND run_id = $2
        RETURNING *`,
      [
        params.storeId,
        params.rootRunId,
        releasedCalls,
        releasedTokens,
        releasedCost,
        totalTokens,
        params.measuredCostUsd,
      ],
    );
    const updatedRoot = mapAgentRunRow(updated.rows[0] as Record<string, unknown>);
    const b = updatedRoot.budget;
    const exceeded =
      b.consumedTokens + b.reservedTokens > b.maxTokens ||
      b.consumedModelCalls + b.reservedModelCalls > b.maxModelCalls ||
      b.consumedCostUsd + b.reservedCostUsd > b.maxCostUsd;

    if (exceeded && !isTerminalAgentRunStatus(updatedRoot.status)) {
      await markRootTreeBudgetExceeded(
        client,
        params.storeId,
        params.rootRunId,
        'reconciled_usage_exceeded_budget',
      );
    }

    return { budgetExceeded: exceeded };
  });
}

export async function reserveChildDelegationRun(
  pool: Pool,
  params: {
    storeId: string;
    rootRunId: string;
    parentHermesSessionId: string;
    childHermesSessionId: string;
    delegationId: string;
    role: AgentRole;
    requestedDepth: number;
    provider: DirectModelProvider;
    model: string;
    promptVersion: string;
  },
): Promise<AgentRunRecord> {
  if (params.role === 'master') {
    throw AppError.forbidden('DELEGATION_ROLE_FORBIDDEN: Cannot spawn a child run with role "master"');
  }
  if (params.requestedDepth > MAX_DELEGATION_DEPTH_HARD_CAP) {
    throw AppError.forbidden(
      `MAX_DELEGATION_DEPTH_EXCEEDED: Depth ${params.requestedDepth} exceeds maximum depth ${MAX_DELEGATION_DEPTH_HARD_CAP} (children cannot spawn grandchildren)`,
    );
  }

  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const root = await lockAndCheckRootBudget(client, params.storeId, params.rootRunId);

    // Verify parent is actually the root run (depth 0), NEVER another child!
    if (root.hermesSessionId !== params.parentHermesSessionId) {
      throw AppError.forbidden(
        'MAX_DELEGATION_DEPTH_EXCEEDED: Child sessions are strictly forbidden from spawning grandchildren',
      );
    }

    const b = root.budget;
    const maxConcurrent = Math.min(MAX_CONCURRENT_CHILDREN_HARD_CAP, b.maxConcurrentChildren);
    if (b.activeChildrenCount >= maxConcurrent) {
      throw AppError.forbidden(
        `MAX_CONCURRENT_CHILDREN_EXCEEDED: Active children (${b.activeChildrenCount}) reached cap (${maxConcurrent})`,
      );
    }
    if (b.totalChildrenSpawned >= b.maxTotalChildren) {
      throw AppError.forbidden(
        `MAX_TOTAL_CHILDREN_EXCEEDED: Total children spawned (${b.totalChildrenSpawned}) reached cap (${b.maxTotalChildren})`,
      );
    }

    await client.query(
      `UPDATE agent_runs
          SET active_children_count = active_children_count + 1,
              total_children_spawned = total_children_spawned + 1,
              updated_at = now()
        WHERE store_id = $1 AND run_id = $2`,
      [params.storeId, params.rootRunId],
    );

    const childRunId = randomUUID();
    const rolePolicy = ROLE_DEFINITIONS[params.role].defaultBudgetPolicy;
    const childDeadline = new Date(
      Math.min(
        new Date(root.budget.deadlineAt).getTime(),
        Date.now() + rolePolicy.maxDurationMs,
      ),
    );

    const inserted = await client.query(
      `INSERT INTO agent_runs (
         store_id, run_id, root_run_id, parent_run_id, conversation_id, session_id,
         customer_id, trigger_message_id, role, depth, status,
         hermes_session_id, delegation_id, provider, model, prompt_version, policy_key,
         context_version, correlation_id,
         budget_max_tokens, budget_max_model_calls, budget_max_tool_calls,
         budget_max_cost_usd, budget_max_concurrent_children, budget_max_total_children,
         deadline_at, started_at, retention_expires_at
       ) VALUES (
         $1, $2, $3, $3, $4, $5,
         $6, $7, $8, 1, 'running',
         $9, $10, $11, $12, $13, $14,
         $15, $16,
         $17, $18, $19,
         $20, 0, 0,
         $21, now(), $22
       )
       RETURNING *`,
      [
        params.storeId,
        childRunId,
        root.runId,
        root.conversationId,
        root.sessionId,
        root.customerId,
        root.triggerMessageId,
        params.role,
        params.childHermesSessionId,
        params.delegationId,
        params.provider,
        params.model,
        params.promptVersion,
        rolePolicy.policyKey,
        root.contextVersion,
        root.correlationId,
        rolePolicy.maxTotalTokens,
        rolePolicy.maxModelCalls,
        rolePolicy.maxToolCalls,
        rolePolicy.maxCostUsd,
        childDeadline,
        new Date(Date.now() + DEFAULT_RUN_TTL_MS),
      ],
    );

    return mapAgentRunRow(inserted.rows[0] as Record<string, unknown>);
  });
}

export async function completeChildDelegationRun(
  pool: Pool,
  params: {
    storeId: string;
    rootRunId: string;
    childHermesSessionId: string;
    status: 'completed' | 'failed' | 'cancelled' | 'timed_out';
    errorMessage?: string;
  },
): Promise<void> {
  await scopedStoreTransaction(pool, params.storeId, async (client) => {
    await client.query(
      `SELECT run_id FROM agent_runs WHERE store_id = $1 AND run_id = $2 FOR UPDATE`,
      [params.storeId, params.rootRunId],
    );
    const updatedChild = await client.query(
      `UPDATE agent_runs
          SET status = CASE WHEN status IN ('queued', 'running', 'cancelling') THEN $4 ELSE status END,
              error_message = COALESCE($5, error_message),
              completed_at = COALESCE(completed_at, now()),
              updated_at = now()
        WHERE store_id = $1
          AND root_run_id = $2
          AND depth = 1
          AND hermes_session_id = $3
          AND status IN ('queued', 'running', 'cancelling')
        RETURNING run_id`,
      [
        params.storeId,
        params.rootRunId,
        params.childHermesSessionId,
        params.status,
        params.errorMessage ?? null,
      ],
    );

    if (updatedChild.rowCount && updatedChild.rowCount > 0) {
      await client.query(
        `UPDATE agent_runs
            SET active_children_count = GREATEST(0, active_children_count - $3),
                updated_at = now()
          WHERE store_id = $1 AND run_id = $2`,
        [params.storeId, params.rootRunId, updatedChild.rowCount],
      );
    }
  });
}

export async function beginToolInvocationAudit(
  pool: Pool,
  params: {
    storeId: string;
    rootRunId: string;
    runId: string;
    sessionId: string;
    role: AgentRole;
    roleVerified: boolean;
    capability: string;
    toolCallId?: string;
    idempotencyKey?: string;
    rawInput: unknown;
    correlationId: string;
    contextVersion: number;
    reserveBudgetSlot: boolean;
  },
): Promise<
  | { kind: 'replayed'; cachedOutput: Record<string, unknown> }
  | { kind: 'started'; invocationId: string }
> {
  const inputRedacted = redactStructuredRecord(params.rawInput);
  const payloadHash = hashPayloadSha256(inputRedacted);

  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    if (params.idempotencyKey) {
      const existing = await client.query<{
        status: string;
        payload_hash: string | null;
        output_redacted: Record<string, unknown> | null;
      }>(
        `SELECT status, payload_hash, output_redacted
           FROM tool_invocations
          WHERE store_id = $1 AND run_id = $2 AND capability = $3 AND idempotency_key = $4
          LIMIT 1`,
        [params.storeId, params.runId, params.capability, params.idempotencyKey],
      );
      const ex = existing.rows[0];
      if (ex) {
        if (ex.payload_hash && ex.payload_hash !== payloadHash) {
          throw AppError.conflict('TOOL_IDEMPOTENCY_CONFLICT: Arguments differ for same idempotencyKey');
        }
        if (ex.status === 'succeeded' && ex.output_redacted) {
          return { kind: 'replayed', cachedOutput: ex.output_redacted };
        }
      }
    }

    if (params.reserveBudgetSlot) {
      const root = await lockAndCheckRootBudget(client, params.storeId, params.rootRunId);
      const b = root.budget;
      if (b.consumedToolCalls + b.reservedToolCalls + 1 > b.maxToolCalls) {
        await markRootTreeBudgetExceeded(
          client,
          params.storeId,
          params.rootRunId,
          'max_tool_calls_exceeded',
        );
        const deniedId = randomUUID();
        await client.query(
          `INSERT INTO tool_invocations (
             store_id, invocation_id, run_id, root_run_id, session_id, role, role_verified,
             capability, tool_call_id, idempotency_key, payload_hash, correlation_id,
             status, context_version, input_redacted, error_code, error_message,
             duration_ms, completed_at, retention_expires_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10, $11, $12,
             'budget_exceeded', $13, $14::jsonb, 'BUDGET_EXCEEDED', 'Max tool calls exceeded',
             0, now(), $15
           )`,
          [
            params.storeId,
            deniedId,
            params.runId,
            params.rootRunId,
            params.sessionId,
            params.role,
            params.roleVerified,
            params.capability,
            params.toolCallId ?? null,
            params.idempotencyKey ?? null,
            payloadHash,
            params.correlationId,
            params.contextVersion,
            JSON.stringify(inputRedacted),
            new Date(Date.now() + DEFAULT_RUN_TTL_MS),
          ],
        );
        throw AppError.forbidden(
          `BUDGET_EXCEEDED: Tool invocation limit (${b.maxToolCalls}) exceeded across parent and child runs`,
        );
      }

      await client.query(
        `UPDATE agent_runs
            SET reserved_tool_calls = reserved_tool_calls + 1,
                updated_at = now()
          WHERE store_id = $1 AND run_id = $2`,
        [params.storeId, params.rootRunId],
      );
    }

    const invocationId = randomUUID();
    await client.query(
      `INSERT INTO tool_invocations (
         store_id, invocation_id, run_id, root_run_id, session_id, role, role_verified,
         capability, tool_call_id, idempotency_key, payload_hash, correlation_id,
         status, context_version, input_redacted, retention_expires_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12,
         'started', $13, $14::jsonb, $15
       )`,
      [
        params.storeId,
        invocationId,
        params.runId,
        params.rootRunId,
        params.sessionId,
        params.role,
        params.roleVerified,
        params.capability,
        params.toolCallId ?? null,
        params.idempotencyKey ?? null,
        payloadHash,
        params.correlationId,
        params.contextVersion,
        JSON.stringify(inputRedacted),
        new Date(Date.now() + DEFAULT_RUN_TTL_MS),
      ],
    );

    return { kind: 'started', invocationId };
  });
}

export async function finalizeToolInvocationAudit(
  pool: Pool,
  params: {
    storeId: string;
    rootRunId: string;
    invocationId: string;
    status: Exclude<ToolInvocationStatus, 'started'>;
    output?: unknown;
    errorCode?: string;
    errorMessage?: string;
    durationMs: number;
    releaseReservedBudgetSlot: boolean;
  },
): Promise<void> {
  const outputRedacted =
    params.output !== undefined ? redactStructuredRecord(params.output) : null;

  await scopedStoreTransaction(pool, params.storeId, async (client) => {
    if (params.releaseReservedBudgetSlot) {
      await client.query(
        `UPDATE agent_runs
            SET reserved_tool_calls = GREATEST(0, reserved_tool_calls - 1),
                consumed_tool_calls = consumed_tool_calls + 1,
                updated_at = now()
          WHERE store_id = $1 AND run_id = $2`,
        [params.storeId, params.rootRunId],
      );
    }

    await client.query(
      `UPDATE tool_invocations
          SET status = $3,
              output_redacted = $4::jsonb,
              error_code = $5,
              error_message = $6,
              duration_ms = $7,
              completed_at = now()
        WHERE store_id = $1 AND invocation_id = $2`,
      [
        params.storeId,
        params.invocationId,
        params.status,
        outputRedacted ? JSON.stringify(outputRedacted) : null,
        params.errorCode ?? null,
        params.errorMessage ? redactSensitiveText(params.errorMessage, 500) : null,
        Math.max(0, Math.round(params.durationMs)),
      ],
    );
  });
}

export async function recordDeniedToolInvocation(
  pool: Pool,
  params: {
    storeId: string;
    rootRunId: string;
    runId: string;
    sessionId: string;
    role: AgentRole;
    roleVerified: boolean;
    capability: string;
    toolCallId?: string;
    rawInput: unknown;
    correlationId: string;
    contextVersion: number;
    status: 'denied' | 'validation_failed' | 'cancelled' | 'timed_out';
    errorCode: string;
    errorMessage: string;
  },
): Promise<void> {
  const inputRedacted = redactStructuredRecord(params.rawInput);
  await scopedStoreTransaction(pool, params.storeId, async (client) => {
    await client.query(
      `INSERT INTO tool_invocations (
         store_id, invocation_id, run_id, root_run_id, session_id, role, role_verified,
         capability, tool_call_id, correlation_id, status, context_version,
         input_redacted, error_code, error_message, duration_ms, completed_at, retention_expires_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12,
         $13::jsonb, $14, $15, 0, now(), $16
       )`,
      [
        params.storeId,
        randomUUID(),
        params.runId,
        params.rootRunId,
        params.sessionId,
        params.role,
        params.roleVerified,
        params.capability,
        params.toolCallId ?? null,
        params.correlationId,
        params.status,
        params.contextVersion,
        JSON.stringify(inputRedacted),
        params.errorCode.slice(0, 80),
        redactSensitiveText(params.errorMessage, 500),
        new Date(Date.now() + DEFAULT_RUN_TTL_MS),
      ],
    );
  });
}

export async function recordActionProposalRecord(
  pool: Pool,
  params: {
    storeId: string;
    runId: string;
    conversationId: string;
    sessionId: string;
    customerId: string | null;
    proposedByRole: AgentRole;
    proposalType: ActionProposalType;
    status?: ActionProposalStatus;
    requiresConfirmation: boolean;
    contextVersion: number;
    payload: Record<string, unknown>;
    correlationId: string;
    idempotencyKey?: string;
  },
): Promise<ActionProposal> {
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const proposalId = randomUUID();
    const expiresAt = new Date(Date.now() + DEFAULT_PROPOSAL_TTL_MS);
    const { rows } = await client.query(
      `INSERT INTO action_proposals (
         store_id, proposal_id, run_id, conversation_id, session_id, customer_id,
         proposed_by_role, proposal_type, status, requires_confirmation,
         context_version, payload, correlation_id, idempotency_key, expires_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10,
         $11, $12::jsonb, $13, $14, $15
       )
       RETURNING *`,
      [
        params.storeId,
        proposalId,
        params.runId,
        params.conversationId,
        params.sessionId,
        params.customerId,
        params.proposedByRole,
        params.proposalType,
        params.status ?? 'proposed',
        params.requiresConfirmation,
        params.contextVersion,
        JSON.stringify(params.payload),
        params.correlationId,
        params.idempotencyKey ?? null,
        expiresAt,
      ],
    );
    return mapActionProposalRow(rows[0] as Record<string, unknown>);
  });
}

export async function advanceRunContextVersion(
  pool: Pool,
  storeId: string,
  rootRunId: string,
  newContextVersion: number,
): Promise<void> {
  await scopedStoreTransaction(pool, storeId, async (client) => {
    await client.query(
      `UPDATE agent_runs
          SET context_version = GREATEST(context_version, $3),
              updated_at = now()
        WHERE store_id = $1 AND root_run_id = $2`,
      [storeId, rootRunId, newContextVersion],
    );
  });
}

export async function listActionProposalsForRun(
  pool: Pool,
  storeId: string,
  runId: string,
): Promise<ActionProposal[]> {
  return scopedStoreTransaction(pool, storeId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM action_proposals
        WHERE store_id = $1
          AND run_id IN (
            SELECT r2.run_id FROM agent_runs r1
            JOIN agent_runs r2 ON r2.store_id = r1.store_id AND r2.root_run_id = r1.root_run_id
            WHERE r1.store_id = $1 AND r1.run_id = $2
          )
        ORDER BY created_at ASC`,
      [storeId, runId],
    );
    return rows.map((r) => mapActionProposalRow(r as Record<string, unknown>));
  });
}

export async function updateActionProposalResolution(
  pool: Pool,
  params: {
    storeId: string;
    proposalId: string;
    status: ActionProposalStatus;
    appliedExperienceRevision?: number | null;
  },
): Promise<void> {
  await scopedStoreTransaction(pool, params.storeId, async (client) => {
    await client.query(
      `UPDATE action_proposals
          SET status = $3,
              applied_experience_revision = COALESCE($4, applied_experience_revision),
              resolved_at = now(),
              updated_at = now()
        WHERE store_id = $1 AND proposal_id = $2`,
      [
        params.storeId,
        params.proposalId,
        params.status,
        params.appliedExperienceRevision ?? null,
      ],
    );
  });
}

export async function cancelAgentRunTree(
  pool: Pool,
  params: {
    storeId: string;
    sessionId: string;
    runId: string;
    reason?: string;
  },
): Promise<{ rootRun: AgentRunRecord; hermesRunId: string | null }> {
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const verifiedSession = await assertActiveSessionOwnership(
      client,
      params.storeId,
      params.sessionId,
    );
    const { rows } = await client.query(
      `SELECT * FROM agent_runs WHERE store_id = $1 AND run_id = $2 FOR UPDATE`,
      [params.storeId, params.runId],
    );
    const targetRow = rows[0] as Record<string, unknown> | undefined;
    if (!targetRow || String(targetRow.session_id) !== verifiedSession.sessionId) {
      throw AppError.notFound('Agent run not found');
    }
    const target = mapAgentRunRow(targetRow);
    const rootRunId = target.rootRunId;

    await client.query(
      `UPDATE agent_runs
          SET status = CASE
                WHEN status IN ('queued', 'running', 'cancelling') THEN 'cancelled'
                ELSE status
              END,
              terminal_reason = COALESCE(terminal_reason, $3),
              cancel_requested_at = COALESCE(cancel_requested_at, now()),
              completed_at = COALESCE(completed_at, now()),
              active_children_count = 0,
              updated_at = now()
        WHERE store_id = $1 AND root_run_id = $2`,
      [params.storeId, rootRunId, (params.reason ?? 'visitor_cancelled').slice(0, 120)],
    );

    await client.query(
      `UPDATE action_proposals
          SET status = 'cancelled',
              resolved_at = now(),
              updated_at = now()
        WHERE store_id = $1
          AND run_id IN (SELECT run_id FROM agent_runs WHERE store_id = $1 AND root_run_id = $2)
          AND status IN ('proposed', 'pending_confirmation')`,
      [params.storeId, rootRunId],
    );

    const refreshed = await client.query(
      `SELECT * FROM agent_runs WHERE store_id = $1 AND run_id = $2`,
      [params.storeId, rootRunId],
    );
    const rootRun = mapAgentRunRow(refreshed.rows[0] as Record<string, unknown>);
    return { rootRun, hermesRunId: rootRun.hermesRunId };
  });
}

export async function finalizeMasterRunAndAcceptMessage(
  pool: Pool,
  params: {
    storeId: string;
    runId: string;
    status: Extract<
      AgentRunStatus,
      'completed' | 'failed' | 'cancelled' | 'superseded' | 'budget_exceeded' | 'timed_out' | 'unknown'
    >;
    assistantContent: string | null;
    structuredPayload?: StructuredMessagePayload;
    validatedOutput?: Record<string, unknown> | null;
    redactedTrace?: Record<string, unknown>;
    publishedExperienceRevision?: number | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    liveSessionContextVersion: number;
  },
): Promise<{
  run: AgentRunRecord;
  assistantMessage: ConversationMessage | null;
  staleBlocked: boolean;
}> {
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM agent_runs WHERE store_id = $1 AND run_id = $2 FOR UPDATE`,
      [params.storeId, params.runId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) throw AppError.notFound('Agent run not found');
    const current = mapAgentRunRow(row);

    // Enforce Master-only direct communication invariant!
    if (current.role !== 'master' || current.depth !== 0) {
      throw AppError.forbidden('MASTER_ONLY_SPEAKER: Specialist child runs cannot emit visitor messages');
    }

    // Check if already superseded/cancelled/budget_exceeded or if visitor context advanced
    const alreadyAborted =
      current.status === 'cancelled' ||
      current.status === 'superseded' ||
      current.status === 'budget_exceeded' ||
      current.status === 'timed_out';

    const contextMoved = params.liveSessionContextVersion > current.contextVersion;
    const staleBlocked = alreadyAborted || contextMoved;

    // Idempotent return if assistant message was already accepted for this run
    const existingMsg = await client.query(
      `SELECT * FROM messages
        WHERE store_id = $1 AND run_id = $2 AND role = 'assistant' AND status = 'accepted'
        LIMIT 1`,
      [params.storeId, params.runId],
    );
    if (existingMsg.rows[0]) {
      return {
        run: current,
        assistantMessage: mapMessageRow(existingMsg.rows[0] as Record<string, unknown>),
        staleBlocked: false,
      };
    }

    const effectiveStatus: AgentRunStatus = alreadyAborted
      ? current.status
      : contextMoved && params.status === 'completed'
        ? 'superseded'
        : params.status;

    const cleanTrace = params.redactedTrace
      ? redactStructuredRecord(params.redactedTrace)
      : current.redactedTrace;

    const updatedRunRes = await client.query(
      `UPDATE agent_runs
          SET status = $3,
              terminal_reason = COALESCE(terminal_reason, $4),
              validated_output = COALESCE($5::jsonb, validated_output),
              redacted_trace = $6::jsonb,
              published_experience_revision = COALESCE($7, published_experience_revision),
              error_code = COALESCE($8, error_code),
              error_message = COALESCE($9, error_message),
              completed_at = COALESCE(completed_at, now()),
              active_children_count = 0,
              updated_at = now()
        WHERE store_id = $1 AND run_id = $2
        RETURNING *`,
      [
        params.storeId,
        params.runId,
        effectiveStatus,
        contextMoved ? 'context_version_superseded' : effectiveStatus,
        params.validatedOutput ? JSON.stringify(redactStructuredRecord(params.validatedOutput)) : null,
        JSON.stringify(cleanTrace),
        staleBlocked ? null : (params.publishedExperienceRevision ?? null),
        params.errorCode ?? null,
        params.errorMessage ? redactSensitiveText(params.errorMessage, 500) : null,
      ],
    );
    const updatedRun = mapAgentRunRow(updatedRunRes.rows[0] as Record<string, unknown>);

    if (staleBlocked) {
      await client.query(
        `UPDATE action_proposals
            SET status = CASE WHEN $3::boolean THEN 'superseded' ELSE 'cancelled' END,
                resolved_at = now(),
                updated_at = now()
          WHERE store_id = $1
            AND run_id IN (SELECT run_id FROM agent_runs WHERE store_id = $1 AND root_run_id = $2)
            AND status IN ('proposed', 'pending_confirmation')`,
        [params.storeId, params.runId, contextMoved],
      );
      return { run: updatedRun, assistantMessage: null, staleBlocked: true };
    }

    if (effectiveStatus !== 'completed' || !params.assistantContent) {
      return { run: updatedRun, assistantMessage: null, staleBlocked: false };
    }

    const sanitizedAssistant = redactSensitiveText(params.assistantContent, 16_000);
    if (!sanitizedAssistant) {
      return { run: updatedRun, assistantMessage: null, staleBlocked: false };
    }

    const convRes = await client.query<{ message_seq: string }>(
      `UPDATE conversations
          SET message_seq = message_seq + 1,
              last_context_version = GREATEST(last_context_version, $3),
              updated_at = now()
        WHERE store_id = $1 AND conversation_id = $2
        RETURNING message_seq`,
      [params.storeId, updatedRun.conversationId, updatedRun.contextVersion],
    );
    const seq = Number(convRes.rows[0]?.message_seq ?? 1);
    const structured = structuredMessagePayloadSchema.parse(params.structuredPayload ?? {});

    const insertedMsg = await client.query(
      `INSERT INTO messages (
         store_id, message_id, conversation_id, session_id, run_id,
         sequence, role, status, content, structured_payload,
         context_version, correlation_id, retention_expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'assistant', 'accepted', $7, $8::jsonb, $9, $10, $11)
       RETURNING *`,
      [
        params.storeId,
        randomUUID(),
        updatedRun.conversationId,
        updatedRun.sessionId,
        updatedRun.runId,
        seq,
        sanitizedAssistant,
        JSON.stringify(structured),
        updatedRun.contextVersion,
        updatedRun.correlationId,
        new Date(Date.now() + DEFAULT_CONVERSATION_TTL_MS),
      ],
    );

    return {
      run: updatedRun,
      assistantMessage: mapMessageRow(insertedMsg.rows[0] as Record<string, unknown>),
      staleBlocked: false,
    };
  });
}

export async function upsertConversationSummaryRecord(
  pool: Pool,
  params: {
    storeId: string;
    conversationId: string;
    coveredUpToSequence: number;
    summaryText: string;
    personalizationConsented: boolean;
    provenance: Record<string, unknown>;
  },
): Promise<ConversationSummary> {
  const sanitized = redactSensitiveText(params.summaryText, 4_000);
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    const { rows } = await client.query(
      `INSERT INTO conversation_summaries (
         store_id, summary_id, conversation_id, covered_up_to_sequence,
         summary_text, personalization_consented, provenance, retention_expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (store_id, conversation_id, covered_up_to_sequence) DO UPDATE
         SET summary_text = EXCLUDED.summary_text,
             personalization_consented = EXCLUDED.personalization_consented,
             provenance = EXCLUDED.provenance
       RETURNING *`,
      [
        params.storeId,
        randomUUID(),
        params.conversationId,
        params.coveredUpToSequence,
        sanitized,
        params.personalizationConsented,
        JSON.stringify(redactStructuredRecord(params.provenance)),
        new Date(Date.now() + DEFAULT_CONVERSATION_TTL_MS),
      ],
    );
    const row = rows[0] as Record<string, unknown>;
    return conversationSummarySchema.parse({
      summaryId: String(row.summary_id),
      storeId: String(row.store_id),
      conversationId: String(row.conversation_id),
      coveredUpToSequence: Number(row.covered_up_to_sequence),
      summaryText: String(row.summary_text),
      personalizationConsented: Boolean(row.personalization_consented),
      provenance: (row.provenance as Record<string, unknown>) ?? {},
      retentionExpiresAt: isoDate(row.retention_expires_at),
      createdAt: isoDate(row.created_at),
    });
  });
}

export async function purgeExpiredIntelligenceData(
  pool: Pool,
  storeId: string,
  asOf: Date = new Date(),
): Promise<Record<string, number>> {
  return scopedStoreTransaction(pool, storeId, async (client) => {
    const { rows } = await client.query<{ result: Record<string, number> }>(
      `SELECT purge_expired_intelligence($1, $2) AS result`,
      [storeId, asOf],
    );
    return rows[0]?.result ?? {};
  });
}

// ============================================================================
// FL07 — Active Session Conversation Reuse, Post-Run Publication & AG-UI Stream Log
// ============================================================================

const DEFAULT_RUN_EVENT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RETAINED_EVENTS_PER_RUN = 400;

export async function getLatestActiveConversationForSession(
  pool: Pool,
  params: { storeId: string; sessionId: string },
): Promise<Conversation | null> {
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    await assertActiveSessionOwnership(client, params.storeId, params.sessionId);
    const { rows } = await client.query(
      `SELECT * FROM conversations
        WHERE store_id = $1 AND session_id = $2 AND status = 'active' AND retention_expires_at > now()
        ORDER BY updated_at DESC
        LIMIT 1`,
      [params.storeId, params.sessionId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? mapConversationRow(row) : null;
  });
}

export async function getOwnedActionProposalById(
  pool: Pool,
  params: { storeId: string; sessionId: string; proposalId: string },
): Promise<ActionProposal | null> {
  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    await assertActiveSessionOwnership(client, params.storeId, params.sessionId);
    const { rows } = await client.query(
      `SELECT * FROM action_proposals
        WHERE store_id = $1 AND session_id = $2 AND proposal_id = $3
        LIMIT 1`,
      [params.storeId, params.sessionId, params.proposalId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? mapActionProposalRow(row) : null;
  });
}

export async function markRunPublishedExperienceRevision(
  pool: Pool,
  params: {
    storeId: string;
    runId: string;
    proposalId: string;
    experienceRevision: number;
  },
): Promise<void> {
  await scopedStoreTransaction(pool, params.storeId, async (client) => {
    await client.query(
      `UPDATE action_proposals
          SET status = 'applied',
              applied_experience_revision = $3,
              resolved_at = COALESCE(resolved_at, now()),
              updated_at = now()
        WHERE store_id = $1 AND proposal_id = $2`,
      [params.storeId, params.proposalId, params.experienceRevision],
    );
    await client.query(
      `UPDATE agent_runs
          SET published_experience_revision = $3,
              updated_at = now()
        WHERE store_id = $1 AND run_id = $2`,
      [params.storeId, params.runId, params.experienceRevision],
    );
    await client.query(
      `UPDATE messages
          SET structured_payload = jsonb_set(
                COALESCE(structured_payload, '{}'::jsonb),
                '{experienceRevision}',
                to_jsonb($3::bigint),
                true
              )
        WHERE store_id = $1 AND run_id = $2 AND role = 'assistant'`,
      [params.storeId, params.runId, params.experienceRevision],
    );
  });
}

export async function appendAgentRunStreamEvent(
  pool: Pool,
  params: {
    storeId: string;
    runId: string;
    event: AGUIEvent;
    sourceKey?: string;
    maxRetainedEvents?: number;
  },
): Promise<PersistedAgUiStreamEnvelope> {
  const checked = validateSafeAgUiEvent(params.event);
  if (!checked.ok) {
    throw AppError.unprocessable(`UNSAFE_AGUI_EVENT: ${checked.reason}`);
  }
  const maxRetained = Math.min(
    1_000,
    Math.max(32, params.maxRetainedEvents ?? MAX_RETAINED_EVENTS_PER_RUN),
  );

  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    if (params.sourceKey) {
      const existing = await client.query(
        `SELECT event_seq::text AS event_seq, event_id, payload
           FROM agent_run_events
          WHERE store_id = $1 AND run_id = $2 AND source_key = $3
          LIMIT 1`,
        [params.storeId, params.runId, params.sourceKey],
      );
      const existingRow = existing.rows[0] as
        | { event_seq: string; event_id: string; payload: unknown }
        | undefined;
      if (existingRow) {
        const reparsed = validateSafeAgUiEvent(existingRow.payload);
        if (!reparsed.ok) {
          throw AppError.unavailable('Corrupted persisted AG-UI event payload');
        }
        return {
          eventSeq: Number(existingRow.event_seq),
          eventId: existingRow.event_id,
          runId: params.runId,
          event: reparsed.event,
        };
      }
    }

    const seqRes = await client.query<{ event_seq: string }>(
      `UPDATE agent_runs
          SET event_seq = event_seq + 1,
              updated_at = now()
        WHERE store_id = $1 AND run_id = $2
        RETURNING event_seq::text AS event_seq`,
      [params.storeId, params.runId],
    );
    const seqRow = seqRes.rows[0];
    if (!seqRow) {
      throw AppError.notFound('Agent run not found for stream event append');
    }
    const eventSeq = Number(seqRow.event_seq);
    const eventId = `${params.runId}:${eventSeq}`;

    await client.query(
      `INSERT INTO agent_run_events (
         store_id, run_id, event_seq, event_id, ag_ui_type,
         source_key, payload, retention_expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        params.storeId,
        params.runId,
        eventSeq,
        eventId,
        checked.event.type,
        params.sourceKey ?? null,
        JSON.stringify(checked.event),
        new Date(Date.now() + DEFAULT_RUN_EVENT_TTL_MS),
      ],
    );

    if (eventSeq > maxRetained) {
      await client.query(
        `DELETE FROM agent_run_events
          WHERE store_id = $1 AND run_id = $2 AND event_seq <= $3`,
        [params.storeId, params.runId, eventSeq - maxRetained],
      );
    }

    return {
      eventSeq,
      eventId,
      runId: params.runId,
      event: checked.event,
    };
  });
}

export async function listAgentRunStreamEvents(
  pool: Pool,
  params: {
    storeId: string;
    sessionId: string;
    runId: string;
    afterSeq?: number;
    limit?: number;
  },
): Promise<{
  events: PersistedAgUiStreamEnvelope[];
  minRetainedSeq: number | null;
  latestEventSeq: number;
  resyncRequired: boolean;
}> {
  const afterSeq = Math.max(0, Math.trunc(params.afterSeq ?? 0));
  const limit = Math.min(500, Math.max(1, Math.trunc(params.limit ?? 250)));

  return scopedStoreTransaction(pool, params.storeId, async (client) => {
    await assertActiveSessionOwnership(client, params.storeId, params.sessionId);

    const runRes = await client.query<{ event_seq: string }>(
      `SELECT event_seq::text AS event_seq
         FROM agent_runs
        WHERE store_id = $1 AND session_id = $2 AND run_id = $3
        LIMIT 1`,
      [params.storeId, params.sessionId, params.runId],
    );
    const runRow = runRes.rows[0];
    if (!runRow) {
      throw AppError.notFound('Agent run not found for active visitor session');
    }
    const latestEventSeq = Number(runRow.event_seq);

    const minRes = await client.query<{ min_seq: string | null }>(
      `SELECT MIN(event_seq)::text AS min_seq
         FROM agent_run_events
        WHERE store_id = $1 AND run_id = $2`,
      [params.storeId, params.runId],
    );
    const minRetainedSeq =
      minRes.rows[0]?.min_seq !== null && minRes.rows[0]?.min_seq !== undefined
        ? Number(minRes.rows[0].min_seq)
        : null;

    const resyncRequired =
      afterSeq > 0 &&
      ((minRetainedSeq === null && latestEventSeq > 0) ||
        (minRetainedSeq !== null && minRetainedSeq > afterSeq + 1));

    const { rows } = await client.query<{
      event_seq: string;
      event_id: string;
      payload: unknown;
    }>(
      `SELECT event_seq::text AS event_seq, event_id, payload
         FROM agent_run_events
        WHERE store_id = $1 AND run_id = $2 AND event_seq > $3
        ORDER BY event_seq ASC
        LIMIT $4`,
      [params.storeId, params.runId, afterSeq, limit],
    );

    const events: PersistedAgUiStreamEnvelope[] = [];
    for (const r of rows) {
      const validated = validateSafeAgUiEvent(r.payload);
      if (validated.ok) {
        events.push({
          eventSeq: Number(r.event_seq),
          eventId: r.event_id,
          runId: params.runId,
          event: validated.event,
        });
      }
    }

    return {
      events,
      minRetainedSeq,
      latestEventSeq,
      resyncRequired,
    };
  });
}
