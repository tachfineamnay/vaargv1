-- FL05-FIX: provider is part of vector identity. Legacy rows have no proven
-- provider/generation identity and must be reindexed, never silently relabelled.
ALTER TABLE catalog_product_embeddings ADD COLUMN provider text NOT NULL DEFAULT 'legacy-unverified'
  CHECK (char_length(provider) BETWEEN 1 AND 64);
ALTER TABLE catalog_product_embeddings DROP CONSTRAINT catalog_product_embeddings_pkey;
ALTER TABLE catalog_product_embeddings ADD PRIMARY KEY
  (store_id, country, language, product_gid, provider, model, model_version);

-- Retention clears optional/current-request content without recycling a live
-- session's version numbers (ABA). Minimal revision tombstones expire with
-- identity; expired operational events and recommendation payloads are removed.
CREATE OR REPLACE FUNCTION purge_expired_experience(p_store_id uuid, p_now timestamptz DEFAULT now())
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE deleted bigint := 0; n bigint;
BEGIN
  DELETE FROM intent_signals WHERE store_id=p_store_id AND expires_at<=p_now;
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted+n;
  DELETE FROM interaction_events WHERE store_id=p_store_id AND expires_at<=p_now;
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted+n;
  DELETE FROM recommendation_items WHERE store_id=p_store_id AND run_id IN
    (SELECT run_id FROM recommendation_runs WHERE store_id=p_store_id AND expires_at<=p_now);
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted+n;
  DELETE FROM recommendation_runs WHERE store_id=p_store_id AND expires_at<=p_now;
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted+n;
  UPDATE experience_revisions r SET state='{}',context_version=r.context_version+1,
    updated_at=p_now,expires_at=vs.expires_at
    FROM visitor_sessions vs WHERE r.store_id=p_store_id AND r.expires_at<=p_now
      AND vs.store_id=r.store_id AND vs.session_id=r.session_id
      AND vs.status='active' AND vs.expires_at>p_now;
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted+n;
  DELETE FROM experience_revisions WHERE store_id=p_store_id AND expires_at<=p_now;
  GET DIAGNOSTICS n=ROW_COUNT; deleted:=deleted+n;
  RETURN deleted;
END;
$$;
