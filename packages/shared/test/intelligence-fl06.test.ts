import { describe, expect, it } from 'vitest';
import {
  ACTIVE_TOOL_CAPABILITIES,
  AGENT_ROLES,
  FORBIDDEN_RUNTIME_TOOLS,
  FUTURE_WORKFLOW_NAMES,
  IMPLEMENTED_WORKFLOW_NAMES,
  MAX_CONCURRENT_CHILDREN_HARD_CAP,
  MAX_DELEGATION_DEPTH_HARD_CAP,
  ROLE_DEFINITIONS,
  SAFE_READ_CAPABILITY_INTERSECTION,
  WORKFLOW_CONTRACT_REGISTRY,
  brokerGetProductInputSchema,
  brokerSearchCatalogInputSchema,
  findForbiddenAuthorityKeys,
  getEffectiveCapabilitiesForRole,
  getRoleDefinition,
  getToolJsonSchemasForAdvertisedCapabilities,
  implementedWorkflowNameSchema,
  proposeCompositionOutputSchema,
  stripHiddenReasoning,
  submitMessageInputSchema,
} from '../src/index.js';

describe('FL06 shared intelligence, specialist, ToolBroker, and workflow contracts', () => {
  it('enforces bounded Master -> Specialist hierarchy (depth <= 1, max 3 children, no grandchildren)', () => {
    expect(AGENT_ROLES).toEqual([
      'master',
      'discovery',
      'experience',
      'commerce',
      'memory',
      'marketing',
      'support',
    ]);

    expect(MAX_CONCURRENT_CHILDREN_HARD_CAP).toBe(3);
    expect(MAX_DELEGATION_DEPTH_HARD_CAP).toBe(1);
    expect(getRoleDefinition('master').delegationEnabled).toBe(true);

    for (const role of AGENT_ROLES.filter((r) => r !== 'master')) {
      expect(ROLE_DEFINITIONS[role].delegationEnabled).toBe(false);
    }
  });

  it('enforces explicit per-role ToolBroker capability allowlists and runtime tool denylist', () => {
    expect(ACTIVE_TOOL_CAPABILITIES).toHaveLength(10);
    expect(FORBIDDEN_RUNTIME_TOOLS.size).toBeGreaterThanOrEqual(20);

    for (const forbidden of [
      'terminal',
      'execute_code',
      'read_file',
      'write_file',
      'browser_exec',
      'web_search',
      'memory',
      'sql',
      'docker',
    ]) {
      expect(FORBIDDEN_RUNTIME_TOOLS.has(forbidden)).toBe(true);
    }
    expect(FORBIDDEN_RUNTIME_TOOLS.has('search_catalog')).toBe(false);

    // Only verified master can update explicit session criteria
    expect(getEffectiveCapabilitiesForRole('master', true)).toContain('update_explicit_criteria');
    expect(getEffectiveCapabilitiesForRole('master', false)).not.toContain(
      'update_explicit_criteria',
    );
    expect(getEffectiveCapabilitiesForRole('discovery', true)).not.toContain(
      'update_explicit_criteria',
    );
    expect(getEffectiveCapabilitiesForRole('experience', true)).not.toContain(
      'update_explicit_criteria',
    );

    // Only verified master and experience can propose adaptive UI compositions
    expect(getEffectiveCapabilitiesForRole('master', true)).toContain(
      'propose_experience_composition',
    );
    expect(getEffectiveCapabilitiesForRole('experience', true)).toContain(
      'propose_experience_composition',
    );
    expect(getEffectiveCapabilitiesForRole('experience', false)).toEqual(
      expect.arrayContaining([...SAFE_READ_CAPABILITY_INTERSECTION].filter((c) =>
        ROLE_DEFINITIONS.experience.allowedCapabilities.includes(c),
      )),
    );
    expect(getEffectiveCapabilitiesForRole('discovery', true)).not.toContain(
      'propose_experience_composition',
    );
    expect(getEffectiveCapabilitiesForRole('support', true)).not.toContain(
      'propose_experience_composition',
    );

    // Memory role has narrow context read access only
    const memorySchemas = getToolJsonSchemasForAdvertisedCapabilities(
      getEffectiveCapabilitiesForRole('memory', true),
    );
    expect(memorySchemas.map((s) => s.name)).toEqual(['get_experience_context']);
  });

  it('rejects caller-supplied tenant/session/consent/signal fields on ToolBroker inputs', () => {
    expect(
      brokerSearchCatalogInputSchema.safeParse({
        q: 'industrial valve',
        mode: 'hybrid',
        limit: 8,
      }).success,
    ).toBe(true);

    for (const forgedField of [
      { storeId: '00000000-0000-4000-8000-000000000001' },
      { sessionId: '00000000-0000-4000-8000-000000000002' },
      { country: 'US' },
      { consent: { personalization: true } },
      { signals: [{ kind: 'product_viewed', subject: 'x', weight: 1 }] },
    ]) {
      expect(findForbiddenAuthorityKeys(forgedField).length).toBeGreaterThan(0);
      expect(
        brokerSearchCatalogInputSchema.safeParse({
          q: 'valve',
          ...forgedField,
        }).success,
      ).toBe(false);
    }

    expect(brokerGetProductInputSchema.safeParse({}).success).toBe(false);
    expect(
      brokerGetProductInputSchema.safeParse({
        shopifyGid: 'gid://shopify/Product/12345',
      }).success,
    ).toBe(true);
  });

  it('strips hidden chain-of-thought and validates non-mutating composition proposals', () => {
    const cleaned = stripHiddenReasoning(
      '<think>SECRET INTERNAL CHAIN OF THOUGHT</think>Grounded DN50 valve summary.',
    );
    expect(cleaned).toBe('Grounded DN50 valve summary.');
    expect(cleaned).not.toContain('SECRET INTERNAL CHAIN OF THOUGHT');

    expect(
      submitMessageInputSchema.safeParse({
        content: 'Show me DN50 stainless steel ball valves',
        idempotencyKey: 'turn-key-001',
      }).success,
    ).toBe(true);

    expect(
      proposeCompositionOutputSchema.safeParse({
        proposalId: '00000000-0000-4000-8000-000000000099',
        status: 'proposed',
        composition: {
          sessionId: '00000000-0000-4000-8000-000000000002',
          contextVersion: 3,
          experienceRevision: 1,
          mode: 'ssr',
          adaptationReason: 'explicit_criteria',
          freshness: '2026-11-27T12:00:00.000Z',
          sections: [
            {
              id: 'chips-1',
              component: 'SuggestionChips',
              chips: [{ label: 'Valves', href: '/collections/valves' }],
            },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it('distinguishes implemented FL06 Hatchet workflows from unimplemented future phase contracts', () => {
    expect(IMPLEMENTED_WORKFLOW_NAMES).toEqual([
      'vaarg.catalog.sync',
      'vaarg.embeddings.refresh',
      'vaarg.experience.retention_cleanup',
    ]);

    for (const name of IMPLEMENTED_WORKFLOW_NAMES) {
      expect(implementedWorkflowNameSchema.safeParse(name).success).toBe(true);
      expect(WORKFLOW_CONTRACT_REGISTRY[name].implemented).toBe(true);
    }

    for (const futureName of FUTURE_WORKFLOW_NAMES) {
      expect(implementedWorkflowNameSchema.safeParse(futureName).success).toBe(false);
      expect(WORKFLOW_CONTRACT_REGISTRY[futureName].implemented).toBe(false);
    }
  });
});
