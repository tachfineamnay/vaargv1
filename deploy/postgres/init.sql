-- VAARG V1 — PostgreSQL 18 initialization.
-- Correct pgvector extension name is `vector`.
-- This script runs once on first initialization of a fresh data directory.
CREATE EXTENSION IF NOT EXISTS vector;
