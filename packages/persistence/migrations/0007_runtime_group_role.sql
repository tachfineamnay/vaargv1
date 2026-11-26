-- The inherited migration created a public, fixed login password. Make the
-- grant-bearing role a non-login group; provision separate restricted login
-- roles out of band and grant this role before upgrading a shared cluster.
ALTER ROLE vaarg_app NOLOGIN PASSWORD NULL;
