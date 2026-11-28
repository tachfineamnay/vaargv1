-- FL07-FIX — abuse enforcement follow-up (forward, after 0016).
-- Historical migrations are untouched. Additive only.

-- The abuse_limit_events durable ledger is written on every enforcement
-- decision. Extend the intelligence retention purge so expired abuse
-- events are reclaimed alongside the other intelligence retention data.
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
  v_publications bigint := 0;
  v_abuse bigint := 0;
BEGIN
  DELETE FROM agent_run_events WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_run_events = ROW_COUNT;

  DELETE FROM action_proposals
   WHERE store_id = p_store_id AND expires_at <= p_now
     AND status IN ('proposed', 'pending_confirmation', 'stale', 'rejected', 'superseded', 'cancelled', 'expired', 'unavailable');
  GET DIAGNOSTICS v_proposals = ROW_COUNT;

  DELETE FROM proposal_publications WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_publications = ROW_COUNT;

  DELETE FROM tool_invocations WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_tools = ROW_COUNT;

  DELETE FROM model_usage WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_usage = ROW_COUNT;

  DELETE FROM conversation_summaries WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_summaries = ROW_COUNT;

  DELETE FROM messages WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_messages = ROW_COUNT;

  DELETE FROM abuse_limit_events WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_abuse = ROW_COUNT;

  DELETE FROM agent_runs
   WHERE store_id = p_store_id AND retention_expires_at <= p_now
     AND status IN ('completed', 'failed', 'cancelled', 'superseded', 'budget_exceeded', 'timed_out', 'unknown');
  GET DIAGNOSTICS v_runs = ROW_COUNT;

  DELETE FROM conversations WHERE store_id = p_store_id AND retention_expires_at <= p_now;
  GET DIAGNOSTICS v_conversations = ROW_COUNT;

  RETURN jsonb_build_object(
    'agent_run_events', v_run_events,
    'action_proposals', v_proposals,
    'proposal_publications', v_publications,
    'tool_invocations', v_tools,
    'model_usage', v_usage,
    'conversation_summaries', v_summaries,
    'messages', v_messages,
    'abuse_limit_events', v_abuse,
    'agent_runs', v_runs,
    'conversations', v_conversations
  );
END;
$$;
