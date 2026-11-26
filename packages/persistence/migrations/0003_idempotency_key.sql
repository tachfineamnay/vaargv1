-- Preserve old rows without assuming an old payload hash is a caller-provided key.
ALTER TABLE idempotency_keys ADD COLUMN idempotency_key varchar(200);
UPDATE idempotency_keys SET idempotency_key = 'legacy:' || key_id::text;
ALTER TABLE idempotency_keys ALTER COLUMN idempotency_key SET NOT NULL;
DROP INDEX idempotency_keys_scope_principal_hash_uidx;
CREATE UNIQUE INDEX idempotency_keys_scope_principal_key_uidx ON idempotency_keys(store_id, scope, principal, idempotency_key);
