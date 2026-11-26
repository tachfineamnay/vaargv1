-- Enforce tenant ownership of referenced customer and merchant records.
CREATE UNIQUE INDEX customers_store_customer_uidx ON customers(store_id, customer_id);
CREATE UNIQUE INDEX merchant_users_store_user_uidx ON merchant_users(store_id, merchant_user_id);
ALTER TABLE customer_identities ADD CONSTRAINT customer_identities_store_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES customers(store_id, customer_id) ON DELETE CASCADE;
ALTER TABLE consent_records ADD CONSTRAINT consent_records_store_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES customers(store_id, customer_id) ON DELETE CASCADE;
ALTER TABLE marketing_permissions ADD CONSTRAINT marketing_permissions_store_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES customers(store_id, customer_id) ON DELETE CASCADE;
ALTER TABLE privacy_requests ADD CONSTRAINT privacy_requests_store_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES customers(store_id, customer_id) ON DELETE CASCADE;
ALTER TABLE visitor_sessions ADD CONSTRAINT visitor_sessions_store_customer_fk FOREIGN KEY (store_id, customer_id) REFERENCES customers(store_id, customer_id);
ALTER TABLE store_memberships ADD CONSTRAINT store_memberships_store_user_fk FOREIGN KEY (store_id, merchant_user_id) REFERENCES merchant_users(store_id, merchant_user_id) ON DELETE CASCADE;
