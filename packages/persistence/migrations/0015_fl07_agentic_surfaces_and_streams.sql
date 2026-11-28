-- FL07 TASK 00 / TASK 02 — durable AG-UI stream sequencing/replay, stale proposal status,
-- and non-complete catalog continuation workflow status.
-- Forward migration after 0014_intelligence_domain.sql (historical migrations untouched).

-- ---------------------------------------------------------------------------
-- 1. Extend action_proposals.status to include explicit 'stale' resolution
-- ---------------------------------------------------------------------------
ALTER TABLE action_proposals DROP CONSTRAINT IF EXISTS action_proposals_status_check;
ALTER TABLE action_proposals ADD CONSTRAINT action_proposals_status_check CHECK (
  status IN (
    'proposed', 'pending_confirmation', 'confirmed', 'applied', 'stale',
    'rejected', 'superseded', 'cancelled', 'expired', 'unavailable'
  )
);

-- ---------------------------------------------------------------------------
-- 2. Extend workflow_executions.status to include 'continuation_required'
--    so bounded page-budget exhaustion is never presented as completed sync
-- ---------------------------------------------------------------------------
ALTER TABLE workflow_executions DROP CONSTRAINT IF EXISTS workflow_executions_status_check;
ALTER TABLE workflow_executions ADD CONSTRAINT workflow_executions_status_check CHECK (
  status IN (
    'pending_submission', 'submission_unknown', 'submitted',
    'running', 'continuation_required', 'completed',
    'failed', 'cancelled', 'not_implemented'
  )
);

-- ---------------------------------------------------------------------------
-- 3. Monotonic stream sequence counter on agent_runs + durable agent_run_events
-- ---------------------------------------------------------------------------
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS event_seq bigint NOT NULL DEFAULT 0 CHECK (event_seq >= 0);

CREATE TABLE agent_run_events (
  store_id uuid NOT NULL REFERENCES stores(store_id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  event_seq bigint NOT NULL CHECK (event_seq > 0),
  event_id varchar(160) NOT NULL,
  ag_ui_type varchar(64) NOT NULL,
  source_key varchar(160),
  payload jsonb NOT NULL CHECK (pg_column_size(payload) <= 262144),
  retention_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, run_id, event_seq),
  FOREIGN KEY (store_id, run_id)
    REFERENCES agent_runs(store_id, run_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX agent_run_events_source_key_uidx
  ON agent_run_events(store_id, run_id, source_key)
  WHERE source_key IS NOT NULL;

CREATE INDEX agent_run_events_retention_idx
  ON agent_run_events(store_id, retention_expires_at);

ALTER TABLE agent_run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_events FORCE ROW LEVEL SECURITY;

CREATE POLICY agent_run_events_tenant ON agent_run_events
  USING (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid)
  WITH CHECK (store_id = NULLIF(current_setting('app.store_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_run_events TO vaarg_app;

-- ---------------------------------------------------------------------------
-- 4. Update retention helper to purge expired agent_run_events & 'stale' proposals
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION purge_expired_intelligence(p_store_id uuid, p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_run_events bigint := 0;
  v_proposals bigint := 0;
  v_tools bigint := 0;
  v_usage bigint := 0;
  v_summaries bigint := 0;
  v_messages bigint := 0;
  v_runs bigint := 0;
  v_conversations bigint := 0;
BEGIN
  DELETE FROM agent_run_events WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_run_events = ROW_COUNT;

  DELETE FROM action_proposals
   WHERE store_id = p_store_id AND expires_at <= p_now
     AND status IN ('proposed', 'pending_confirmation', 'stale', 'rejected', 'superseded', 'cancelled', 'expired', 'unavailable');
  GET DIAGNOSTICS v_proposals = ROW_COUNT;

  DELETE FROM tool_invocations WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_tools = ROW_COUNT;

  DELETE FROM model_usage WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_usage = ROW_COUNT;

  DELETE FROM conversation_summaries WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_summaries = ROW_COUNT;

  DELETE FROM messages WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_messages = ROW_COUNT;

  DELETE FROM agent_runs
   WHERE store_id = p_store_id AND retention_expires_at <= p_now
     AND status IN ('completed', 'failed', 'cancelled', 'superseded', 'budget_exceeded', 'timed_out', 'unknown');
  GET DIAGNOSTICS v_runs = ROW_COUNT;

  DELETE FROM conversations WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_conversations = ROW_COUNT;

  RETURN jsonb_build_object(
    'agent_run_events', v_run_events,
    'action_proposals', v_proposals,
    'tool_invocations', v_tools,
    'model_usage', v_usage,
    'conversation_summaries', v_summaries,
    'messages', v_messages,
    'agent_runs', v_runs,
    'conversations', v_conversations
  );
END;
$$;

GRANT EXECUTE ON FUNCTION purge_expired_intelligence(uuid, timestamptz) TO vaarg_app;
