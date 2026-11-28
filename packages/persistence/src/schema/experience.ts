import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
  foreignKey,
  primaryKey,
  integer,
  text,
  jsonb,
  numeric,
  doublePrecision,
  bigint,
  boolean,
} from 'drizzle-orm/pg-core';
import { stores, customers } from './identity.js';
import { catalogProducts } from './catalog.js';

export const sessionStatusEnum = pgEnum('session_status', [
  'active',
  'expired',
  'rotated',
  'revoked',
]);

/**
 * visitor_sessions — anonymous visitor sessions. Store-scoped. Token is
 * stored hashed; rotation creates a new row and revokes the old.
 */
export const visitorSessions = pgTable(
  'visitor_sessions',
  {
    sessionId: uuid('session_id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    customerId: uuid('customer_id').references(() => customers.customerId, {
      onDelete: 'set null',
    }),
    tokenHash: varchar('token_hash', { length: 128 }).notNull(),
    status: sessionStatusEnum('status').notNull().default('active'),
    context: varchar('context', { length: 32 }).notNull().default('default'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    rotatedFrom: uuid('rotated_from'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('visitor_sessions_store_token_hash_uidx').on(table.storeId, table.tokenHash),
    foreignKey({ name: 'visitor_sessions_store_customer_fk', columns: [table.storeId, table.customerId], foreignColumns: [customers.storeId, customers.customerId] }),
    index('visitor_sessions_store_status_idx').on(table.storeId, table.status),
    index('visitor_sessions_store_customer_idx').on(table.storeId, table.customerId),
  ],
);

export type VisitorSession = typeof visitorSessions.$inferSelect;
export type NewVisitorSession = typeof visitorSessions.$inferInsert;

// ---------------------------------------------------------------------------
// FL05 Experience tables (migration 0012) — Drizzle declarations.
// These tables already exist in the database; the declarations complete the
// typed projection layer so typed reads/writes are possible without raw SQL.
// ---------------------------------------------------------------------------

export const interactionEventTypeEnum = pgEnum('interaction_event_type', [
  'category_selected',
  'collection_viewed',
  'product_viewed',
  'search_submitted',
  'filter_changed',
  'comparison_changed',
  'explicit_preference_updated',
  'exploration_reset',
  'conversation_message',
  'cart_action_confirmed',
]);

export const interactionEvents = pgTable(
  'interaction_events',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    eventType: interactionEventTypeEnum('event_type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    personalizationAllowed: boolean('personalization_allowed').notNull().default(false),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ name: 'interaction_events_pkey', columns: [table.storeId, table.eventId] }),
    foreignKey({
      name: 'interaction_events_store_session_fk',
      columns: [table.storeId, table.sessionId],
      foreignColumns: [visitorSessions.storeId, visitorSessions.sessionId],
    }).onDelete('cascade'),
    index('interaction_events_session_seq_idx').on(table.storeId, table.sessionId, table.seq),
    index('interaction_events_retention_idx').on(table.storeId, table.expiresAt),
  ],
);

export const intentSignalKindEnum = pgEnum('intent_signal_kind', [
  'category_selected',
  'collection_viewed',
  'product_viewed',
  'search_submitted',
  'filter_changed',
  'comparison_changed',
]);

export const intentSignals = pgTable(
  'intent_signals',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    signalId: uuid('signal_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    kind: intentSignalKindEnum('kind').notNull(),
    subject: text('subject').notNull(),
    weight: numeric('weight', { precision: 4, scale: 3 }).notNull(),
    inferred: boolean('inferred').notNull().default(true),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ name: 'intent_signals_pkey', columns: [table.storeId, table.signalId] }),
    foreignKey({
      name: 'intent_signals_store_session_fk',
      columns: [table.storeId, table.sessionId],
      foreignColumns: [visitorSessions.storeId, visitorSessions.sessionId],
    }).onDelete('cascade'),
    uniqueIndex('intent_signals_session_kind_subject_uidx').on(
      table.storeId,
      table.sessionId,
      table.kind,
      table.subject,
    ),
    index('intent_signals_session_idx').on(table.storeId, table.sessionId, table.observedAt.desc()),
    index('intent_signals_retention_idx').on(table.storeId, table.expiresAt),
  ],
);

export const experienceRevisions = pgTable(
  'experience_revisions',
  {
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').notNull(),
    state: jsonb('state').notNull().default({}),
    contextVersion: bigint('context_version', { mode: 'number' }).notNull().default(0),
    experienceRevision: bigint('experience_revision', { mode: 'number' }).notNull().default(0),
    brandRevision: text('brand_revision'),
    configurationRevision: text('configuration_revision'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ name: 'experience_revisions_pkey', columns: [table.storeId, table.sessionId] }),
    foreignKey({
      name: 'experience_revisions_store_session_fk',
      columns: [table.storeId, table.sessionId],
      foreignColumns: [visitorSessions.storeId, visitorSessions.sessionId],
    }).onDelete('cascade'),
    index('experience_revisions_retention_idx').on(table.storeId, table.expiresAt),
  ],
);

export const recommendationRunStatusEnum = pgEnum('recommendation_run_status', [
  'pending',
  'published',
  'superseded',
  'stale',
  'failed',
  'cancelled',
]);
export const recommendationStrategyEnum = pgEnum('recommendation_strategy', [
  'criteria',
  'contextual',
  'related',
  'market_default',
]);

export const recommendationRuns = pgTable(
  'recommendation_runs',
  {
    runId: uuid('run_id').notNull(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.storeId, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').notNull(),
    country: text('country').notNull(),
    language: text('language').notNull(),
    contextVersion: bigint('context_version', { mode: 'number' }).notNull(),
    experienceRevision: bigint('experience_revision', { mode: 'number' }).notNull(),
    status: recommendationRunStatusEnum('status').notNull().default('pending'),
    strategy: recommendationStrategyEnum('strategy').notNull(),
    channels: text('channels').array().notNull().default([]),
    consentLimited: boolean('consent_limited').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ name: 'recommendation_runs_pkey', columns: [table.storeId, table.runId] }),
    foreignKey({
      name: 'recommendation_runs_store_session_fk',
      columns: [table.storeId, table.sessionId],
      foreignColumns: [visitorSessions.storeId, visitorSessions.sessionId],
    }).onDelete('cascade'),
    index('recommendation_runs_session_idx').on(table.storeId, table.sessionId, table.createdAt.desc()),
    index('recommendation_runs_status_idx').on(table.storeId, table.status, table.createdAt.desc()),
    index('recommendation_runs_retention_idx').on(table.storeId, table.expiresAt),
  ],
);

export const recommendationItems = pgTable(
  'recommendation_items',
  {
    storeId: uuid('store_id').notNull(),
    runId: uuid('run_id').notNull(),
    country: text('country').notNull(),
    language: text('language').notNull(),
    productGid: text('product_gid').notNull(),
    position: integer('position').notNull(),
    reasonCodes: text('reason_codes').array().notNull().default([]),
    score: doublePrecision('score').notNull(),
    provenance: jsonb('provenance').notNull().default({}),
  },
  (table) => [
    primaryKey({ name: 'recommendation_items_pkey', columns: [table.storeId, table.runId, table.productGid] }),
    foreignKey({
      name: 'recommendation_items_store_run_fk',
      columns: [table.storeId, table.runId],
      foreignColumns: [recommendationRuns.storeId, recommendationRuns.runId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'recommendation_items_store_product_fk',
      columns: [table.storeId, table.country, table.language, table.productGid],
      foreignColumns: [catalogProducts.storeId, catalogProducts.country, catalogProducts.language, catalogProducts.productGid],
    }).onDelete('cascade'),
    uniqueIndex('recommendation_items_run_position_uidx').on(table.storeId, table.runId, table.position),
  ],
);

export type InteractionEvent = typeof interactionEvents.$inferSelect;
export type NewInteractionEvent = typeof interactionEvents.$inferInsert;
export type IntentSignal = typeof intentSignals.$inferSelect;
export type NewIntentSignal = typeof intentSignals.$inferInsert;
export type ExperienceRevision = typeof experienceRevisions.$inferSelect;
export type NewExperienceRevision = typeof experienceRevisions.$inferInsert;
export type RecommendationRun = typeof recommendationRuns.$inferSelect;
export type NewRecommendationRun = typeof recommendationRuns.$inferInsert;
export type RecommendationItem = typeof recommendationItems.$inferSelect;
export type NewRecommendationItem = typeof recommendationItems.$inferInsert;
