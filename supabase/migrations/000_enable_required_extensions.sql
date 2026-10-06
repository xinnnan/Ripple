-- Prerequisite extensions for a fresh environment.
--
-- Migration 009 declares VECTOR(1536) columns, but pgvector was historically
-- enabled by hand in the SQL editor before running 001+. That left fresh
-- staging, disaster-recovery, and `supabase db reset` environments unable to
-- build the schema. This file sorts before 001 and is a no-op wherever the
-- extension already exists (including production), so it never rewrites
-- applied history.
--
-- The documented manual step (`CREATE EXTENSION IF NOT EXISTS vector;`) placed
-- the extension in the first search_path schema, public. Keep that location so
-- the unqualified VECTOR type in migration 009 resolves identically everywhere.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
