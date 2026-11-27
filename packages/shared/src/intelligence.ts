import { z } from 'zod';
import { consentStateSchema } from './application.js';
import { adaptiveCompositionSchema } from './composition.js';
import { explorationCriteriaSchema } from './experience.js';

export const HERMES_PINNED_VERSION = '0.23.4' as const;
export const HERMES_PINNED_COMMIT = '8fc0374447313e276f6b9a2764bfc750190c966a' as const;

export const AGENT_ROLES = [
  'master',
  'discovery',
  'experience',
  'commerce',
  'memory',
  'marketing',
  'support',
] as const;
export const agentRoleSchema = z.enum(AGENT_ROLES);
export type AgentRole = z.infer<typeof agentRoleSchema>;

export const SPECIALIST_ROLES = [
  'discovery',
  'experience',
  'commerce',
  'memory',
  'marketing',
  'support',
] as const;
export const specialistRoleSchema = z.enum(SPECIALIST_ROLES);
export type SpecialistRole = z.infer<typeof specialistRoleSchema>;

export const CONVERSATION_STATUSES = ['active', 'closed', 'expired', 'deleted'] as const;
export const conversationStatusSchema = z.enum(CONVERSATION_STATUSES);
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

export const MESSAGE_ROLES = ['user', 'assistant'] as const;
export const messageRoleSchema = z.enum(MESSAGE_ROLES);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const MESSAGE_STATUSES = ['accepted', 'superseded', 'cancelled', 'redacted'] as const;
export const messageStatusSchema = z.enum(MESSAGE_STATUSES);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

export const AGENT_RUN_STATUSES = [
  'queued',
  'running',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
  'superseded',
  'budget_exceeded',
  'timed_out',
  'unknown',
] as const;
export const agentRunStatusSchema = z.enum(AGENT_RUN_STATUSES);
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;

export const TERMINAL_AGENT_RUN_STATUSES: ReadonlySet<AgentRunStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
  'superseded',
  'budget_exceeded',
  'timed_out',
  'unknown',
]);

export function isTerminalAgentRunStatus(status: AgentRunStatus): boolean {
  return TERMINAL_AGENT_RUN_STATUSES.has(status);
}

export const DIRECT_MODEL_PROVIDERS = ['gemini', 'deepseek'] as const;
export const directModelProviderSchema = z.enum(DIRECT_MODEL_PROVIDERS);
export type DirectModelProvider = z.infer<typeof directModelProviderSchema>;

export const FORBIDDEN_MODEL_PROVIDERS = [
  'openrouter',
  'nous',
  'nous-api',
  'nous-portal',
  'anthropic',
  'openai',
  'openai-codex',
  'auto',
  'moa',
  'custom',
  'bedrock',
  'vertex-unmanaged',
] as const;

export const PROVIDER_AVAILABILITY_STATES = ['enabled', 'disabled', 'not_configured'] as const;
export const providerAvailabilitySchema = z.enum(PROVIDER_AVAILABILITY_STATES);
export type ProviderAvailability = z.infer<typeof providerAvailabilitySchema>;

export const modelPricingSchema = z
  .object({
    inputCostPerMillionUsd: z.number().nonnegative().max(10_000),
    outputCostPerMillionUsd: z.number().nonnegative().max(10_000),
    cacheReadCostPerMillionUsd: z.number().nonnegative().max(10_000).default(0),
    cacheWriteCostPerMillionUsd: z.number().nonnegative().max(10_000).default(0),
    verified: z.boolean(),
  })
  .superRefine((pricing, ctx) => {
    if (
      pricing.verified &&
      pricing.inputCostPerMillionUsd <= 0 &&
      pricing.outputCostPerMillionUsd <= 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Verified commercial model pricing cannot treat both input and output rates as zero cost',
      });
    }
  });
export type ModelPricing = z.infer<typeof modelPricingSchema>;

export const providerPolicySchema = z
  .object({
    provider: directModelProviderSchema,
    model: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine(
        (m) =>
          m !== 'auto' &&
          !m.includes('*') &&
          !m.toLowerCase().startsWith('openrouter/') &&
          !m.toLowerCase().startsWith('nous/'),
        'Model identifier must be an explicit direct Gemini or DeepSeek model without wildcards or aggregators',
      ),
    permittedRoles: z.array(agentRoleSchema).min(1).max(7),
    maxContextTokens: z.number().int().min(1024).max(2_000_000),
    maxOutputTokens: z.number().int().min(128).max(65_536),
    timeoutMs: z.number().int().min(1_000).max(300_000),
    pricing: modelPricingSchema,
    allowImplicitFallback: z.literal(false),
    availability: providerAvailabilitySchema,
  })
  .strict();
export type ProviderPolicy = z.infer<typeof providerPolicySchema>;

export interface TokenUsageBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/**
 * Computes conservative USD cost (6 decimal micro-USD precision, rounded up)
 * from a verified provider policy. Fails closed when pricing is unverified or zero.
 */
export function calculateVerifiedModelCostUsd(
  pricing: ModelPricing,
  usage: TokenUsageBreakdown,
): number {
  if (!pricing.verified) {
    throw new Error('UNVERIFIED_MODEL_PRICING: Cannot compute cost for unverified model policy');
  }
  if (pricing.inputCostPerMillionUsd <= 0 && pricing.outputCostPerMillionUsd <= 0) {
    throw new Error('UNVERIFIED_MODEL_PRICING: Zero-cost commercial model policy is forbidden');
  }
  const input = Math.max(0, Math.trunc(usage.inputTokens));
  const output = Math.max(0, Math.trunc(usage.outputTokens));
  const cacheRead = Math.max(0, Math.trunc(usage.cacheReadTokens ?? 0));
  const cacheWrite = Math.max(0, Math.trunc(usage.cacheWriteTokens ?? 0));
  if (
    !Number.isFinite(usage.inputTokens) ||
    !Number.isFinite(usage.outputTokens) ||
    usage.inputTokens < 0 ||
    usage.outputTokens < 0
  ) {
    throw new Error('INVALID_MODEL_USAGE: Token counts must be non-negative finite integers');
  }

  const rawUsd =
    (input * pricing.inputCostPerMillionUsd +
      output * pricing.outputCostPerMillionUsd +
      cacheRead * pricing.cacheReadCostPerMillionUsd +
      cacheWrite * pricing.cacheWriteCostPerMillionUsd) /
    1_000_000;

  if (rawUsd === 0 && (input > 0 || output > 0 || cacheRead > 0 || cacheWrite > 0)) {
    return 0.000001;
  }
  return Math.ceil(rawUsd * 1_000_000) / 1_000_000;
}

export const MAX_CONCURRENT_CHILDREN_HARD_CAP = 3 as const;
export const MAX_DELEGATION_DEPTH_HARD_CAP = 1 as const;
export const MAX_TOTAL_CHILDREN_HARD_CAP = 12 as const;

export const runBudgetPolicySchema = z.object({
  policyKey: z.string().min(1).max(80),
  role: agentRoleSchema,
  allowedCapabilities: z.array(z.string().min(1).max(120)).max(32),
  delegationEnabled: z.boolean().default(false),
  maxConcurrentChildren: z.number().int().min(0).max(MAX_CONCURRENT_CHILDREN_HARD_CAP).default(3),
  maxDelegationDepth: z.number().int().min(0).max(MAX_DELEGATION_DEPTH_HARD_CAP).default(1),
  maxTotalChildren: z.number().int().min(0).max(MAX_TOTAL_CHILDREN_HARD_CAP).default(6),
  maxTotalTokens: z.number().int().min(256).max(500_000),
  maxModelCalls: z.number().int().min(1).max(64),
  maxToolCalls: z.number().int().min(0).max(64),
  maxCostUsd: z.number().positive().max(25),
  maxDurationMs: z.number().int().min(1_000).max(300_000),
});
export type RunBudgetPolicy = z.infer<typeof runBudgetPolicySchema>;

export const runBudgetStateSchema = z.object({
  maxTokens: z.number().int().positive(),
  maxModelCalls: z.number().int().positive(),
  maxToolCalls: z.number().int().nonnegative(),
  maxCostUsd: z.number().positive(),
  maxConcurrentChildren: z.number().int().min(0).max(MAX_CONCURRENT_CHILDREN_HARD_CAP),
  maxTotalChildren: z.number().int().min(0).max(MAX_TOTAL_CHILDREN_HARD_CAP),
  reservedTokens: z.number().int().nonnegative(),
  consumedTokens: z.number().int().nonnegative(),
  reservedModelCalls: z.number().int().nonnegative(),
  consumedModelCalls: z.number().int().nonnegative(),
  reservedToolCalls: z.number().int().nonnegative(),
  consumedToolCalls: z.number().int().nonnegative(),
  reservedCostUsd: z.number().nonnegative(),
  consumedCostUsd: z.number().nonnegative(),
  activeChildrenCount: z.number().int().min(0).max(MAX_CONCURRENT_CHILDREN_HARD_CAP),
  totalChildrenSpawned: z.number().int().nonnegative(),
  deadlineAt: z.string().datetime(),
});
export type RunBudgetState = z.infer<typeof runBudgetStateSchema>;

export const ACTION_PROPOSAL_TYPES = [
  'experience_composition',
  'explicit_criteria_update',
  'cart_change',
  'checkout_start',
  'memory_preference',
  'campaign_draft',
  'support_case',
] as const;
export const actionProposalTypeSchema = z.enum(ACTION_PROPOSAL_TYPES);
export type ActionProposalType = z.infer<typeof actionProposalTypeSchema>;

export const ACTION_PROPOSAL_STATUSES = [
  'proposed',
  'pending_confirmation',
  'confirmed',
  'applied',
  'stale',
  'rejected',
  'superseded',
  'cancelled',
  'expired',
  'unavailable',
] as const;
export const actionProposalStatusSchema = z.enum(ACTION_PROPOSAL_STATUSES);
export type ActionProposalStatus = z.infer<typeof actionProposalStatusSchema>;

export const actionProposalSchema = z.object({
  proposalId: z.string().uuid(),
  storeId: z.string().uuid(),
  runId: z.string().uuid(),
  conversationId: z.string().uuid(),
  sessionId: z.string().uuid(),
  customerId: z.string().uuid().nullable(),
  proposedByRole: agentRoleSchema,
  proposalType: actionProposalTypeSchema,
  status: actionProposalStatusSchema,
  requiresConfirmation: z.boolean(),
  contextVersion: z.number().int().nonnegative(),
  appliedExperienceRevision: z.number().int().nonnegative().nullable(),
  payload: z.record(z.string(), z.unknown()),
  correlationId: z.string().min(1).max(128),
  idempotencyKey: z.string().min(1).max(200).nullable(),
  expiresAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ActionProposal = z.infer<typeof actionProposalSchema>;

export const TOOL_INVOCATION_STATUSES = [
  'started',
  'succeeded',
  'denied',
  'validation_failed',
  'budget_exceeded',
  'cancelled',
  'timed_out',
  'failed',
] as const;
export const toolInvocationStatusSchema = z.enum(TOOL_INVOCATION_STATUSES);
export type ToolInvocationStatus = z.infer<typeof toolInvocationStatusSchema>;

export const toolInvocationRecordSchema = z.object({
  invocationId: z.string().uuid(),
  storeId: z.string().uuid(),
  runId: z.string().uuid(),
  rootRunId: z.string().uuid(),
  sessionId: z.string().uuid(),
  role: agentRoleSchema,
  roleVerified: z.boolean(),
  capability: z.string().min(1).max(120),
  toolCallId: z.string().max(200).nullable(),
  idempotencyKey: z.string().max(200).nullable(),
  correlationId: z.string().min(1).max(128),
  status: toolInvocationStatusSchema,
  contextVersion: z.number().int().nonnegative(),
  inputRedacted: z.record(z.string(), z.unknown()),
  outputRedacted: z.record(z.string(), z.unknown()).nullable(),
  errorCode: z.string().max(80).nullable(),
  errorMessage: z.string().max(500).nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type ToolInvocationRecord = z.infer<typeof toolInvocationRecordSchema>;

export const modelUsageRecordSchema = z.object({
  usageId: z.string().uuid(),
  storeId: z.string().uuid(),
  runId: z.string().uuid(),
  rootRunId: z.string().uuid(),
  provider: directModelProviderSchema,
  model: z.string().min(1).max(120),
  providerRequestId: z.string().max(200).nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  reservedTokens: z.number().int().nonnegative(),
  reservedCostUsd: z.number().nonnegative(),
  measuredCostUsd: z.number().nonnegative(),
  reconciled: z.boolean(),
  latencyMs: z.number().int().nonnegative().nullable(),
  routeSource: z.string().max(64).nullable(),
  recordedAt: z.string().datetime(),
});
export type ModelUsageRecord = z.infer<typeof modelUsageRecordSchema>;

export const conversationSchema = z.object({
  conversationId: z.string().uuid(),
  storeId: z.string().uuid(),
  sessionId: z.string().uuid(),
  customerId: z.string().uuid().nullable(),
  hermesSessionId: z.string().min(1).max(200),
  status: conversationStatusSchema,
  messageSeq: z.number().int().nonnegative(),
  lastContextVersion: z.number().int().nonnegative(),
  retentionExpiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const structuredMessagePayloadSchema = z
  .object({
    groundedProductRefs: z.array(z.string().min(1).max(200)).max(24).default([]),
    groundedVariantRefs: z.array(z.string().min(1).max(200)).max(24).default([]),
    proposalIds: z.array(z.string().uuid()).max(12).default([]),
    clarificationPrompt: z.string().max(1_000).nullable().default(null),
    confirmationRequired: z.boolean().default(false),
    experienceRevision: z.number().int().nonnegative().nullable().default(null),
  })
  .strict();
export type StructuredMessagePayload = z.infer<typeof structuredMessagePayloadSchema>;

export const conversationMessageSchema = z.object({
  messageId: z.string().uuid(),
  storeId: z.string().uuid(),
  conversationId: z.string().uuid(),
  sessionId: z.string().uuid(),
  runId: z.string().uuid().nullable(),
  sequence: z.number().int().positive(),
  role: messageRoleSchema,
  status: messageStatusSchema,
  content: z.string().min(1).max(16_384),
  structuredPayload: structuredMessagePayloadSchema,
  contextVersion: z.number().int().nonnegative(),
  correlationId: z.string().min(1).max(128),
  idempotencyKey: z.string().min(1).max(200).nullable(),
  createdAt: z.string().datetime(),
});
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

export const conversationSummarySchema = z.object({
  summaryId: z.string().uuid(),
  storeId: z.string().uuid(),
  conversationId: z.string().uuid(),
  coveredUpToSequence: z.number().int().nonnegative(),
  summaryText: z.string().min(1).max(4_096),
  personalizationConsented: z.boolean(),
  provenance: z.record(z.string(), z.unknown()),
  retentionExpiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;

export const agentRunRecordSchema = z.object({
  runId: z.string().uuid(),
  rootRunId: z.string().uuid(),
  parentRunId: z.string().uuid().nullable(),
  storeId: z.string().uuid(),
  conversationId: z.string().uuid(),
  sessionId: z.string().uuid(),
  customerId: z.string().uuid().nullable(),
  triggerMessageId: z.string().uuid().nullable(),
  role: agentRoleSchema,
  depth: z.union([z.literal(0), z.literal(1)]),
  status: agentRunStatusSchema,
  terminalReason: z.string().max(120).nullable(),
  hermesRunId: z.string().max(200).nullable(),
  hermesSessionId: z.string().max(200).nullable(),
  delegationId: z.string().max(200).nullable(),
  provider: directModelProviderSchema,
  model: z.string().min(1).max(120),
  promptVersion: z.string().min(1).max(64),
  policyKey: z.string().min(1).max(80),
  contextVersion: z.number().int().nonnegative(),
  publishedExperienceRevision: z.number().int().nonnegative().nullable(),
  correlationId: z.string().min(1).max(128),
  idempotencyKey: z.string().max(200).nullable(),
  budget: runBudgetStateSchema,
  cancelRequestedAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  redactedTrace: z.record(z.string(), z.unknown()),
  validatedOutput: z.record(z.string(), z.unknown()).nullable(),
  errorCode: z.string().max(80).nullable(),
  errorMessage: z.string().max(500).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AgentRunRecord = z.infer<typeof agentRunRecordSchema>;

export const submitMessageInputSchema = z
  .object({
    content: z.string().trim().min(1).max(4_000),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type SubmitMessageInput = z.infer<typeof submitMessageInputSchema>;

export const startConversationRunInputSchema = z
  .object({
    message: z.string().trim().min(1).max(4_000).optional(),
    triggerMessageId: z.string().uuid().optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type StartConversationRunInput = z.infer<typeof startConversationRunInputSchema>;

export const publishRunCompositionInputSchema = z
  .object({
    proposalId: z.string().uuid().optional(),
    expectedContextVersion: z.number().int().nonnegative().optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type PublishRunCompositionInput = z.infer<typeof publishRunCompositionInputSchema>;

export const publishRunCompositionResultSchema = z.object({
  published: z.boolean(),
  replayed: z.boolean(),
  runId: z.string().uuid(),
  proposalId: z.string().uuid(),
  contextVersion: z.number().int().nonnegative(),
  experienceRevision: z.number().int().nonnegative(),
  composition: adaptiveCompositionSchema,
});
export type PublishRunCompositionResult = z.infer<typeof publishRunCompositionResultSchema>;

export const validatedAgentRunResultSchema = z.object({
  runId: z.string().uuid(),
  conversationId: z.string().uuid(),
  status: agentRunStatusSchema,
  contextVersion: z.number().int().nonnegative(),
  stale: z.boolean(),
  assistantMessage: conversationMessageSchema.nullable(),
  proposals: z.array(actionProposalSchema),
  compositionProposal: adaptiveCompositionSchema.nullable(),
  criteriaUpdated: explorationCriteriaSchema.nullable(),
  consentSnapshot: consentStateSchema,
  delegationStatus: z.enum(['ENABLED', 'DISABLED_CAPABILITY_LIMITATION', 'NOT_REQUESTED']),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
export type ValidatedAgentRunResult = z.infer<typeof validatedAgentRunResultSchema>;

// ============================================================================
// AgentPort (Provider-Independent Runtime Port)
// ============================================================================

export const agentHistoryTurnSchema = z
  .object({
    role: messageRoleSchema,
    content: z.string().min(1).max(16_384),
  })
  .strict();
export type AgentHistoryTurn = z.infer<typeof agentHistoryTurnSchema>;

export interface StartAgentRunRequest {
  internalRunId: string;
  storeId: string;
  sessionId: string;
  conversationId: string;
  hermesSessionId: string;
  hermesSessionKey: string;
  idempotencyKey: string;
  correlationId: string;
  input: string;
  instructions: string;
  conversationHistory: AgentHistoryTurn[];
  provider: DirectModelProvider;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
  bridgeMetadata?: Record<string, string>;
  signal?: AbortSignal;
}

export interface AgentRunHandle {
  internalRunId: string;
  externalRunId: string;
  status: 'queued' | 'running';
  replayed: boolean;
}

export interface GetAgentRunRequest {
  internalRunId: string;
  externalRunId: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AgentRunUsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AgentRunRuntimeMetadata {
  provider: string | null;
  model: string | null;
  routeSource: string | null;
  requestedProvider: string | null;
  requestedModel: string | null;
}

export interface AgentRunSnapshot {
  externalRunId: string;
  status: AgentRunStatus;
  rawStatus: string;
  sessionId: string | null;
  output: string | null;
  error: string | null;
  partial: boolean;
  interrupted: boolean;
  turnExitReason: string | null;
  usage: AgentRunUsageSnapshot | null;
  runtime: AgentRunRuntimeMetadata | null;
}

export interface ObserveAgentRunRequest {
  internalRunId: string;
  externalRunId: string;
  afterSeq?: number;
  maxEvents?: number;
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
  signal?: AbortSignal;
}

export type AgentRunEvent =
  | {
      type: 'message.delta';
      externalRunId: string;
      seq: number;
      timestamp: number;
      delta: string;
    }
  | {
      type: 'message.interim';
      externalRunId: string;
      seq: number;
      timestamp: number;
      text: string;
    }
  | {
      type: 'tool.started';
      externalRunId: string;
      seq: number;
      timestamp: number;
      tool: string;
      toolCallId: string | null;
    }
  | {
      type: 'tool.completed';
      externalRunId: string;
      seq: number;
      timestamp: number;
      tool: string;
      toolCallId: string | null;
      durationMs: number | null;
      failed: boolean;
    }
  | {
      type: 'subagent.start';
      externalRunId: string;
      seq: number;
      timestamp: number;
      subagentId: string;
      childSessionId: string | null;
      delegationId: string | null;
      depth: number;
      model: string | null;
    }
  | {
      type: 'subagent.complete';
      externalRunId: string;
      seq: number;
      timestamp: number;
      subagentId: string;
      childSessionId: string | null;
      delegationId: string | null;
      status: string;
      inputTokens: number;
      outputTokens: number;
      apiCalls: number;
      costUsd: number;
    }
  | {
      type: 'replay.truncated';
      externalRunId: string;
      seq: number;
      timestamp: number;
      oldestRetainedSeq: number;
      requestedSeq: number;
    }
  | {
      type: 'run.terminal';
      externalRunId: string;
      seq: number;
      timestamp: number;
      status: Extract<AgentRunStatus, 'completed' | 'failed' | 'cancelled' | 'unknown'>;
      output: string | null;
      error: string | null;
      usage: AgentRunUsageSnapshot | null;
    };

export interface CancelAgentRunRequest {
  internalRunId: string;
  externalRunId: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CancelAgentRunResult {
  externalRunId: string;
  accepted: boolean;
  status: 'cancelling' | AgentRunStatus;
}

export interface AgentRuntimeCapabilities {
  status: 'AVAILABLE' | 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'UNSAFE_CONFINEMENT';
  runtimeName: 'hermes';
  pinnedVersion: string;
  reportedVersion: string | null;
  runSubmission: boolean;
  runStatus: boolean;
  runEventsSse: boolean;
  runStop: boolean;
  preventiveHooksVerified: boolean;
  delegationSupported: boolean;
  delegationLimitationReason: string | null;
  enabledToolsets: string[];
  forbiddenToolsDetected: string[];
  implicitFallbackDetected: boolean;
}

export interface AgentRuntimeReadiness {
  status: 'READY' | 'NOT_CONFIGURED' | 'NOT_READY';
  detail: string;
  capabilities: AgentRuntimeCapabilities;
}

export interface AgentPort {
  startRun(request: StartAgentRunRequest): Promise<AgentRunHandle>;
  getRun(request: GetAgentRunRequest): Promise<AgentRunSnapshot>;
  observeRun(request: ObserveAgentRunRequest): AsyncIterable<AgentRunEvent>;
  cancelRun(request: CancelAgentRunRequest): Promise<CancelAgentRunResult>;
  runtimeCapabilities(signal?: AbortSignal): Promise<AgentRuntimeCapabilities>;
  readiness(signal?: AbortSignal): Promise<AgentRuntimeReadiness>;
}

// ============================================================================
// Redaction & Reasoning Stripping Utilities
// ============================================================================

const SENSITIVE_KEY_PATTERN =
  /(password|secret|token|authorization|cookie|api[_-]?key|email|phone|address|card|cvv|ssn|reasoning|thought[_-]?trace|chain[_-]?of[_-]?thought)/i;

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const THINK_BLOCK_PATTERN = /<think>[\s\S]*?<\/think>/gi;
const UNCLOSED_THINK_PATTERN = /<think>[\s\S]*$/gi;

export function stripHiddenReasoning(raw: string): string {
  return raw.replace(THINK_BLOCK_PATTERN, '').replace(UNCLOSED_THINK_PATTERN, '').trim();
}

/**
 * Strips `<think>...</think>` blocks from streamed token deltas WITHOUT trimming
 * natural inter-word whitespace.
 */
export function stripHiddenReasoningDelta(raw: string): string {
  return raw.replace(THINK_BLOCK_PATTERN, '').replace(UNCLOSED_THINK_PATTERN, '');
}

export function redactStreamingDelta(raw: string, maxLength = 4_000): string {
  const withoutReasoning = stripHiddenReasoningDelta(raw);
  const redacted = withoutReasoning
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]');
  return redacted.length > maxLength ? redacted.slice(0, maxLength) : redacted;
}

export function redactSensitiveText(raw: string, maxLength = 4_000): string {
  const withoutReasoning = stripHiddenReasoning(raw);
  const redacted = withoutReasoning
    .replace(BEARER_PATTERN, 'Bearer [REDACTED]')
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]');
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted;
}

export function redactStructuredRecord(
  input: unknown,
  depth = 0,
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  if (depth > 4) {
    return { _truncated: true };
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = '[REDACTED]';
      continue;
    }
    if (typeof value === 'string') {
      out[key] = redactSensitiveText(value, 1_024);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      out[key] = value;
    } else if (Array.isArray(value)) {
      out[key] = value.slice(0, 25).map((item) =>
        typeof item === 'string'
          ? redactSensitiveText(item, 512)
          : item && typeof item === 'object'
            ? redactStructuredRecord(item, depth + 1)
            : item,
      );
    } else if (typeof value === 'object') {
      out[key] = redactStructuredRecord(value, depth + 1);
    }
  }
  return out;
}
