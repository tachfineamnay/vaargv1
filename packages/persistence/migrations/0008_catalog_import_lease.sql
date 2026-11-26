-- Leases are per store and market; no provider request holds a database lock.
ALTER TABLE catalog_imports ADD COLUMN lease_token uuid;
ALTER TABLE catalog_imports ADD COLUMN lease_until timestamptz;
ALTER TABLE catalog_imports ADD CONSTRAINT catalog_import_lease_pair CHECK ((lease_token IS NULL) = (lease_until IS NULL));
