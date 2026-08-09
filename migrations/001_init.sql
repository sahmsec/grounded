-- Phase 1 schema.
-- {{EMBEDDING_DIMENSIONS}} is substituted by the migration runner from config,
-- so a fresh database always matches the configured embedding model.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Source documents. `checksum` makes re-ingestion idempotent: unchanged
-- documents are skipped instead of re-embedded.
CREATE TABLE IF NOT EXISTS documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  source      TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'general',
  content     TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  checksum    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_category_idx ON documents (category);

-- Chunks carry the vectors. Deleting a document removes its chunks.
CREATE TABLE IF NOT EXISTS document_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  chunk_index     INTEGER NOT NULL,
  content         TEXT NOT NULL,
  token_count     INTEGER NOT NULL DEFAULT 0,
  embedding       VECTOR({{EMBEDDING_DIMENSIONS}}) NOT NULL,
  embedding_model TEXT NOT NULL,
  -- Written in Phase 1, read in Phase 2 hybrid retrieval. Adding it later
  -- would mean a migration plus re-embedding every row.
  tsv             TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
  ON document_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS document_chunks_tsv_idx
  ON document_chunks USING gin (tsv);

CREATE INDEX IF NOT EXISTS document_chunks_document_idx
  ON document_chunks (document_id);

-- Daily quota counters survive a restart, so a bounce does not hand every
-- credential a fresh day's allowance it has not actually got.
CREATE TABLE IF NOT EXISTS provider_usage (
  credential_id TEXT NOT NULL,
  usage_date    DATE NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  token_count   BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (credential_id, usage_date)
);
