import {
  AGENT_ROLES,
  AppError,
  FORBIDDEN_MODEL_PROVIDERS,
  calculateVerifiedModelCostUsd,
  providerPolicySchema,
  type AgentRole,
  type AgentRunRuntimeMetadata,
  type DirectModelProvider,
  type ProviderPolicy,
  type TokenUsageBreakdown,
} from '@vaarg/shared';
import { z } from 'zod';

export interface ProviderCredentialsPresence {
  geminiConfigured: boolean;
  deepseekConfigured: boolean;
}

const providerPoliciesArraySchema = z.array(providerPolicySchema).min(1).max(16);

function hasNonPlaceholderKey(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < 12) return false;
  const lower = trimmed.toLowerCase();
  return (
    !lower.includes('replace_me') &&
    !lower.includes('your_') &&
    !lower.includes('placeholder') &&
    !lower.startsWith('<')
  );
}

export function detectDirectProviderCredentials(
  env: Record<string, string | undefined>,
): ProviderCredentialsPresence {
  if (
    hasNonPlaceholderKey(env.OPENROUTER_API_KEY) ||
    hasNonPlaceholderKey(env.NOUS_API_KEY)
  ) {
    throw AppError.badRequest(
      'FORBIDDEN_PROVIDER_CONFIG: OpenRouter and Nous Portal credentials are forbidden in VAARG V1; use direct Gemini API or DeepSeek API only',
    );
  }
  return {
    geminiConfigured: hasNonPlaceholderKey(env.GEMINI_API_KEY),
    deepseekConfigured: hasNonPlaceholderKey(env.DEEPSEEK_API_KEY),
  };
}

/**
 * Default verified direct model policies for Gemini API and DeepSeek API.
 * Availability is dynamically downgraded to `not_configured` when the corresponding
 * direct provider API key is absent (zero simulated or paid calls).
 */
export function buildDefaultProviderPolicies(
  creds: ProviderCredentialsPresence,
): ProviderPolicy[] {
  const defaults: ProviderPolicy[] = [
    {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      permittedRoles: [...AGENT_ROLES],
      maxContextTokens: 131_072,
      maxOutputTokens: 4_096,
      timeoutMs: 30_000,
      pricing: {
        inputCostPerMillionUsd: 0.3,
        outputCostPerMillionUsd: 2.5,
        cacheReadCostPerMillionUsd: 0.075,
        cacheWriteCostPerMillionUsd: 0,
        verified: true,
      },
      allowImplicitFallback: false,
      availability: creds.geminiConfigured ? 'enabled' : 'not_configured',
    },
    {
      provider: 'deepseek',
      model: 'deepseek-chat',
      permittedRoles: [...AGENT_ROLES],
      maxContextTokens: 65_536,
      maxOutputTokens: 4_096,
      timeoutMs: 35_000,
      pricing: {
        inputCostPerMillionUsd: 0.27,
        outputCostPerMillionUsd: 1.1,
        cacheReadCostPerMillionUsd: 0.07,
        cacheWriteCostPerMillionUsd: 0,
        verified: true,
      },
      allowImplicitFallback: false,
      availability: creds.deepseekConfigured ? 'enabled' : 'not_configured',
    },
  ];
  return providerPoliciesArraySchema.parse(defaults);
}

export class ProviderPolicyRegistry {
  private readonly policies: Map<string, ProviderPolicy> = new Map();
  private readonly defaultMasterSelection: { provider: DirectModelProvider; model: string };

  constructor(
    policies: readonly ProviderPolicy[],
    defaultMaster?: { provider: DirectModelProvider; model: string },
  ) {
    const validated = providerPoliciesArraySchema.parse(policies);
    for (const p of validated) {
      if ((FORBIDDEN_MODEL_PROVIDERS as readonly string[]).includes(p.provider)) {
        throw AppError.badRequest(`FORBIDDEN_MODEL_PROVIDER: ${p.provider}`);
      }
      const key = `${p.provider}:${p.model}`;
      if (this.policies.has(key)) {
        throw AppError.badRequest(`DUPLICATE_PROVIDER_POLICY: ${key}`);
      }
      this.policies.set(key, p);
    }

    const first = validated[0]!;
    this.defaultMasterSelection = defaultMaster ?? {
      provider: first.provider,
      model: first.model,
    };
  }

  static fromEnv(env: Record<string, string | undefined> = process.env): ProviderPolicyRegistry {
    const creds = detectDirectProviderCredentials(env);
    let policies: ProviderPolicy[];
    if (env.VAARG_MODEL_POLICIES_JSON && env.VAARG_MODEL_POLICIES_JSON.trim().length > 0) {
      let raw: unknown;
      try {
        raw = JSON.parse(env.VAARG_MODEL_POLICIES_JSON);
      } catch {
        throw AppError.badRequest('INVALID_MODEL_POLICIES_JSON: Failed to parse VAARG_MODEL_POLICIES_JSON');
      }
      const parsed = providerPoliciesArraySchema.safeParse(raw);
      if (!parsed.success) {
        throw AppError.badRequest(
          `INVALID_MODEL_POLICIES: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        );
      }
      policies = parsed.data.map((p) => {
        const keyPresent = p.provider === 'gemini' ? creds.geminiConfigured : creds.deepseekConfigured;
        return {
          ...p,
          availability: p.availability === 'enabled' && !keyPresent ? 'not_configured' : p.availability,
        };
      });
    } else {
      policies = buildDefaultProviderPolicies(creds);
    }

    const defaultProviderRaw = env.VAARG_DEFAULT_MODEL_PROVIDER?.trim();
    const defaultModelRaw = env.VAARG_DEFAULT_MODEL_NAME?.trim();
    if (defaultProviderRaw || defaultModelRaw) {
      if (defaultProviderRaw !== 'gemini' && defaultProviderRaw !== 'deepseek') {
        throw AppError.badRequest(
          `FORBIDDEN_DEFAULT_PROVIDER: "${defaultProviderRaw ?? ''}" — only direct "gemini" or "deepseek" allowed`,
        );
      }
      if (!defaultModelRaw) {
        throw AppError.badRequest('MISSING_DEFAULT_MODEL_NAME: VAARG_DEFAULT_MODEL_NAME is required');
      }
      return new ProviderPolicyRegistry(policies, {
        provider: defaultProviderRaw,
        model: defaultModelRaw,
      });
    }

    // Prefer an enabled policy if one has credentials, else deterministic first policy
    const enabledFirst = policies.find((p) => p.availability === 'enabled') ?? policies[0]!;
    return new ProviderPolicyRegistry(policies, {
      provider: enabledFirst.provider,
      model: enabledFirst.model,
    });
  }

  listPolicies(): ProviderPolicy[] {
    return [...this.policies.values()];
  }

  /**
   * Resolves and strictly enforces provider/model policy for a role (master or child specialist).
   * Never performs implicit fallback to another provider or model.
   */
  resolveForRole(
    role: AgentRole,
    requestedProvider?: string,
    requestedModel?: string,
  ): ProviderPolicy {
    const provider = requestedProvider ?? this.defaultMasterSelection.provider;
    const model = requestedModel ?? this.defaultMasterSelection.model;

    if ((FORBIDDEN_MODEL_PROVIDERS as readonly string[]).includes(provider.toLowerCase())) {
      throw AppError.forbidden(
        `FORBIDDEN_MODEL_PROVIDER: Provider "${provider}" is prohibited; only direct Gemini API and DeepSeek API are permitted`,
      );
    }
    if (provider !== 'gemini' && provider !== 'deepseek') {
      throw AppError.badRequest(`UNSUPPORTED_MODEL_PROVIDER: "${provider}"`);
    }

    const policy = this.policies.get(`${provider}:${model}`);
    if (!policy) {
      throw AppError.forbidden(
        `UNREGISTERED_MODEL_POLICY: No server-owned model policy exists for ${provider}/${model}`,
      );
    }
    if (policy.allowImplicitFallback !== false) {
      throw AppError.forbidden(`IMPLICIT_FALLBACK_FORBIDDEN: Policy ${provider}/${model} allows fallback`);
    }
    if (!policy.permittedRoles.includes(role)) {
      throw AppError.forbidden(
        `MODEL_ROLE_NOT_PERMITTED: Model ${provider}/${model} is not permitted for role "${role}"`,
      );
    }
    if (!policy.pricing.verified) {
      throw AppError.forbidden(
        `UNVERIFIED_MODEL_PRICING: Model ${provider}/${model} has unverified pricing and cannot be treated as zero cost`,
      );
    }
    if (policy.availability === 'not_configured') {
      throw AppError.unavailable(
        `MODEL_PROVIDER_NOT_CONFIGURED: Direct API credentials for ${provider} (${model}) are not configured`,
      );
    }
    if (policy.availability !== 'enabled') {
      throw AppError.unavailable(
        `MODEL_PROVIDER_DISABLED: Model policy ${provider}/${model} is currently ${policy.availability}`,
      );
    }

    return policy;
  }

  estimateReservationCostUsd(
    policy: ProviderPolicy,
    estimatedInputTokens: number,
    maxOutputTokens: number,
  ): { reservedTokens: number; reservedCostUsd: number } {
    const boundedInput = Math.min(
      policy.maxContextTokens,
      Math.max(1, Math.trunc(estimatedInputTokens)),
    );
    const boundedOutput = Math.min(
      policy.maxOutputTokens,
      Math.max(1, Math.trunc(maxOutputTokens)),
    );
    const reservedCostUsd = calculateVerifiedModelCostUsd(policy.pricing, {
      inputTokens: boundedInput,
      outputTokens: boundedOutput,
    });
    return {
      reservedTokens: boundedInput + boundedOutput,
      reservedCostUsd,
    };
  }

  computeMeasuredCostUsd(policy: ProviderPolicy, usage: TokenUsageBreakdown): number {
    return calculateVerifiedModelCostUsd(policy.pricing, usage);
  }

  /**
   * Verifies Hermes runtime metadata after or during execution to ensure no implicit
   * fallback or unauthorized provider/model substitution occurred.
   */
  verifyServedRuntimeRoute(
    expectedPolicy: ProviderPolicy,
    runtime: AgentRunRuntimeMetadata | null,
  ): void {
    if (!runtime) return;
    if (runtime.routeSource && runtime.routeSource.toLowerCase().includes('fallback')) {
      throw AppError.forbidden(
        `IMPLICIT_FALLBACK_DETECTED: Runtime reported fallback route_source="${runtime.routeSource}"`,
      );
    }
    if (runtime.provider && runtime.provider.toLowerCase() !== expectedPolicy.provider) {
      throw AppError.forbidden(
        `RUNTIME_PROVIDER_MISMATCH: Requested "${expectedPolicy.provider}" but runtime served "${runtime.provider}"`,
      );
    }
    if (runtime.model && runtime.model !== expectedPolicy.model) {
      throw AppError.forbidden(
        `RUNTIME_MODEL_MISMATCH: Requested "${expectedPolicy.model}" but runtime served "${runtime.model}"`,
      );
    }
  }
}
