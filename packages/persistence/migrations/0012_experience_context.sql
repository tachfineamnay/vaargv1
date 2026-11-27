-- FL05 TASK 03/04 — unified visitor experience context (forward, after 0011).
-- Durable PostgreSQL authority for interaction events, intent signals,
-- experience revisions (contextVersion / experienceRevision CAS) and
-- recommendation runs/items. Store-scoped foreign keys, RLS and explicit
-- retention (expires_at) controls throughout. Valkey only ever holds derived
-- active-session state. Previously applied migrations are not modified.

-- Store-scoped composite key for session foreign keys (session_id alone is
-- the PK; the composite unique index lets every child table bind store+session).
CREATE UNIQUE INDEX visitor_sessions_store_session_uidx
  ON visitor_sessions(store_id, session_id);

-- ---------------------------------------------------------------------------
-- interaction_events — validated, deduplicated, server-ordered
-- ---------------------------------------------------------------------------
CREATE TABLE interaction_events (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  -- Client-unique event id; (store_id, event_id) is the idempotency key.
  event_id uuid NOT NULL,
  session_id uuid NOT NULL,
  -- Server-assigned global ordering (never client-controlled).
  seq bigint GENERATED ALWAYS AS IDENTITY,
  event_type text NOT NULL CHECK (event_type IN (
    'category_selected', 'collection_viewed', 'product_viewed',
    'search_submitted', 'filter_changed', 'comparison_changed',
    'explicit_preference_updated', 'exploration_reset',
    'conversation_message', 'cart_action_confirmed'
  )),
  -- Bounded payload (validated by shared Zod before insert; hard cap here).
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(payload) <= 4096),
  -- Consent snapshot at ingest: personalization-gated signals only apply
  -- when this is true.
  personalization_allowed boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Explicit retention control (purge job reads expires_at).
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (store_id, event_id),
  FOREIGN KEY (store_id, session_id)
    REFERENCES visitor_sessions(store_id, session_id) ON DELETE CASCADE,
  CHECK (occurred_at <= created_at + interval '1 day')
);
CREATE INDEX interaction_events_session_seq_idx
  ON interaction_events(store_id, session_id, seq);
CREATE INDEX interaction_events_retention_idx
  ON interaction_events(store_id, expires_at);

-- ---------------------------------------------------------------------------
-- intent_signals — bounded, consent-gated, explicitly never a profile
-- ---------------------------------------------------------------------------
CREATE TABLE intent_signals (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  signal_id uuid NOT NULL,
  session_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'category_selected', 'collection_viewed', 'product_viewed',
    'search_submitted', 'filter_changed', 'comparison_changed'
  )),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 300),
  weight numeric(4, 3) NOT NULL CHECK (weight >= 0 AND weight <= 1),
  -- Inferred signals are optional personalization data; explicit criteria
  -- are never stored here.
  inferred boolean NOT NULL DEFAULT true,
  observed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (store_id, signal_id),
  FOREIGN KEY (store_id, session_id)
    REFERENCES visitor_sessions(store_id, session_id) ON DELETE CASCADE,
  -- Deduplication: one live signal per (session, kind, subject).
  UNIQUE (store_id, session_id, kind, subject)
);
CREATE INDEX intent_signals_session_idx
  ON intent_signals(store_id, session_id, observed_at DESC);
CREATE INDEX intent_signals_retention_idx
  ON intent_signals(store_id, expires_at);

-- ---------------------------------------------------------------------------
-- experience_revisions — optimistic concurrency authority (EXP-03)
-- ---------------------------------------------------------------------------
-- One current row per session: reduced context state, contextVersion and
-- experienceRevision. Publishing uses compare-and-set:
--   UPDATE ... SET context_version = $new, state = $state
--   WHERE store_id = $1 AND session_id = $2 AND context_version = $expected
-- A mismatch means the writer observed a stale context and must not apply.

CREATE TABLE experience_revisions (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  -- Reduced context state (ExperienceContext minus server-owned fields).
  state jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(state) <= 65536),
  context_version bigint NOT NULL DEFAULT 0 CHECK (context_version >= 0),
  experience_revision bigint NOT NULL DEFAULT 0 CHECK (experience_revision >= 0),
  brand_revision text,
  configuration_revision text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Explicit retention: idle sessions expire with their derived state.
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (store_id, session_id),
  FOREIGN KEY (store_id, session_id)
    REFERENCES visitor_sessions(store_id, session_id) ON DELETE CASCADE
);
CREATE INDEX experience_revisions_retention_idx
  ON experience_revisions(store_id, expires_at);

-- ---------------------------------------------------------------------------
-- recommendation_runs — published/superseded runs with revision binding
-- ---------------------------------------------------------------------------
CREATE TABLE recommendation_runs (
  run_id uuid NOT NULL,
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  country text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  language text NOT NULL CHECK (language ~ '^[A-Z]{2,3}$'),
  -- Revisions the run was generated against (stale runs are rejected).
  context_version bigint NOT NULL CHECK (context_version >= 0),
  experience_revision bigint NOT NULL CHECK (experience_revision >= 0),
  status text NOT NULL CHECK (status IN (
    'pending', 'published', 'superseded', 'stale', 'failed', 'cancelled'
  )) DEFAULT 'pending',
  strategy text NOT NULL CHECK (strategy IN ('criteria', 'contextual', 'related', 'market_default')),
  channels text[] NOT NULL DEFAULT ARRAY[]::text[],
  consent_limited boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (store_id, run_id),
  FOREIGN KEY (store_id, session_id)
    REFERENCES visitor_sessions(store_id, session_id) ON DELETE CASCADE
);
CREATE INDEX recommendation_runs_session_idx
  ON recommendation_runs(store_id, session_id, created_at DESC);
CREATE INDEX recommendation_runs_status_idx
  ON recommendation_runs(store_id, status, created_at DESC);
CREATE INDEX recommendation_runs_retention_idx
  ON recommendation_runs(store_id, expires_at);

-- ---------------------------------------------------------------------------
-- recommendation_items — verified product references only
-- ---------------------------------------------------------------------------
-- Composite FK to catalog_products guarantees every item is a verified,
-- store+market-scoped catalog product: nothing fabricated can be stored.

CREATE TABLE recommendation_items (
  store_id uuid NOT NULL,
  run_id uuid NOT NULL,
  country text NOT NULL,
  language text NOT NULL,
  product_gid text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  score double precision NOT NULL CHECK (score >= 0),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(provenance) <= 4096),
  PRIMARY KEY (store_id, run_id, product_gid),
  FOREIGN KEY (store_id, run_id)
    REFERENCES recommendation_runs(store_id, run_id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, country, language, product_gid)
    REFERENCES catalog_products(store_id, country, language, product_gid) ON DELETE CASCADE,
  UNIQUE (store_id, run_id, position)
);

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------
ALTER TABLE interaction_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE interaction_events FORCE ROW LEVEL SECURITY;
ALTER TABLE intent_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE intent_signals FORCE ROW LEVEL SECURITY;
ALTER TABLE experience_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE experience_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE recommendation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE recommendation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_items FORCE ROW LEVEL SECURITY;

CREATE POLICY interaction_events_tenant ON interaction_events
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY intent_signals_tenant ON intent_signals
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY experience_revisions_tenant ON experience_revisions
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY recommendation_runs_tenant ON recommendation_runs
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);
CREATE POLICY recommendation_items_tenant ON recommendation_items
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  interaction_events, intent_signals, experience_revisions,
  recommendation_runs, recommendation_items
TO vaarg_app;

-- Explicit retention: purge helpers (called by the scheduled cleanup path).
CREATE FUNCTION purge_expired_experience(p_store_id uuid, p_now timestamptz DEFAULT now())
RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE
  deleted bigint := 0;
  n bigint;
BEGIN
  DELETE FROM intent_signals   WHERE store_id = p_store_id AND expires_at <= p_now; GET DIAGNOSTICS n = ROW_COUNT; deleted := deleted + n;
  DELETE FROM interaction_events WHERE store_id = p_store_id AND expires_at <= p_now; GET DIAGNOSTICS n = ROW_COUNT; deleted := deleted + n;
  DELETE FROM recommendation_items WHERE store_id = p_store_id
    AND run_id IN (SELECT run_id FROM recommendation_runs WHERE store_id = p_store_id AND expires_at <= p_now);
  GET DIAGNOSTICS n = ROW_COUNT; deleted := deleted + n;
  DELETE FROM recommendation_runs WHERE store_id = p_store_id AND expires_at <= p_now;
  GET DIAGNOSTICS n = ROW_COUNT; deleted := deleted + n;
  DELETE FROM experience_revisions WHERE store_id = p_store_id AND expires_at <= p_now;
  GET DIAGNOSTICS n = ROW_COUNT; deleted := deleted + n;
  RETURN deleted;
END;
$$;
