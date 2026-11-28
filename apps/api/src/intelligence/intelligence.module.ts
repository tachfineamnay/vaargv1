import { Module } from '@nestjs/common';
import {
  ConfinementAttestationRegistry,
  HatchetWorkflowDispatcher,
  HermesAgentAdapter,
  ProviderPolicyRegistry,
  loadHermesAdapterConfig,
} from '@vaarg/persistence';
import { ExperienceModule } from '../experience/experience.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { DatabaseClient } from '../infra/database-client.js';
import { InfraModule } from '../infra/infra.module.js';
import { PrivacyModule } from '../privacy/privacy.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';
import { TenantModule } from '../tenant/tenant.module.js';
import { ConversationController } from './conversation.controller.js';
import { ConversationService } from './conversation.service.js';
import { HermesBridgeController } from './hermes-bridge.controller.js';
import {
  AGENT_PORT,
  CONFINEMENT_ATTESTATION_REGISTRY,
  HERMES_BRIDGE_SECRET_TOKEN,
  PROVIDER_POLICY_REGISTRY,
  WORKFLOW_ORCHESTRATION_PORT,
} from './intelligence.tokens.js';
import { ToolBrokerService } from './tool-broker.service.js';

@Module({
  imports: [
    InfraModule,
    TenantModule,
    IdentityModule,
    SessionsModule,
    PrivacyModule,
    ExperienceModule,
  ],
  controllers: [ConversationController, HermesBridgeController],
  providers: [
    ToolBrokerService,
    ConversationService,
    {
      provide: CONFINEMENT_ATTESTATION_REGISTRY,
      useFactory: () => new ConfinementAttestationRegistry(),
    },
    {
      provide: AGENT_PORT,
      inject: [CONFINEMENT_ATTESTATION_REGISTRY],
      useFactory: (attestations: ConfinementAttestationRegistry) =>
        new HermesAgentAdapter(loadHermesAdapterConfig(process.env), fetch, attestations),
    },
    {
      provide: PROVIDER_POLICY_REGISTRY,
      useFactory: () => ProviderPolicyRegistry.fromEnv(process.env),
    },
    {
      provide: HERMES_BRIDGE_SECRET_TOKEN,
      useFactory: () => process.env.HERMES_TOOL_BRIDGE_SECRET?.trim() || undefined,
    },
    {
      provide: WORKFLOW_ORCHESTRATION_PORT,
      inject: [DatabaseClient],
      useFactory: (db: DatabaseClient) => HatchetWorkflowDispatcher.fromEnv(db.getPool(), process.env),
    },
  ],
  exports: [
    ToolBrokerService,
    ConversationService,
    AGENT_PORT,
    PROVIDER_POLICY_REGISTRY,
    WORKFLOW_ORCHESTRATION_PORT,
  ],
})
export class IntelligenceModule {}
