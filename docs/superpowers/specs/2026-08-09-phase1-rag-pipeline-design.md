# grounded — Phase 1 Design Spec

**Date:** 2026-08-09
**Status:** Approved, in implementation
**Scope:** Minimum working RAG pipeline. No admin UI, no chat UI.

Visual companion: `docs/phase1-architecture.html`

---

## 1. Goal

A cybersecurity Q&A backend that answers **only** from a curated knowledge base, cites what it used, and
refuses deterministically when the knowledge base does not cover the question.

Success = the five verification categories in §11 all behave correctly.

## 2. Stack

TypeScript, Node 24, ESM. Runtime dependencies held to two: `pg` and `@google/genai`.
Dev: `vitest`, `tsx`, `typescript`, `@types/*`. No web framework — the HTTP surface is `node:http`.

PostgreSQL 17 + pgvector via `docker-compose`.

## 3. Module layout

```
src/
  config/       env parsing, pool composition, validation
  logging/      structured JSON logger, request-scoped child loggers
  errors/       typed AppError hierarchy
  db/           pool, migration runner, health
  domain/       shared types
  providers/
    llm/        LlmProvider iface + gemini, openai, stub
    embeddings/ EmbeddingProvider iface + gemini, openai, deterministic
    pool/       credential pool, quota tracker, failover, status
  ingest/       chunker (pure), ingestion service
  retrieval/    vector search, relevance gate (pure)
  rag/          prompt builder, answer service
  server/       node:http routes
scripts/        migrate, seed, ask (CLI), smoke
seed/           10 cybersecurity topics (markdown + frontmatter)
tests/          unit + integration
```

Rule: anything decision-making is a **pure function** (chunker, gate, prompt builder, quota math) so it is
testable without a database, a network, or a clock.

## 4. Schema

`documents` — id, slug (unique), title, source, category, content, metadata jsonb, checksum, timestamps.
Checksum makes re-ingestion idempotent.

`document_chunks` — id, document_id (FK cascade), chunk_index, content, token_count,
`embedding vector(768)`, embedding_model, `tsv tsvector`, created_at. Unique on (document_id, chunk_index).
HNSW index on `embedding vector_cosine_ops`. GIN index on `tsv` — populated in Phase 1, read in Phase 2.

`provider_usage` — credential_id, usage_date, request_count, token_count. Unique on (credential_id, usage_date).
Persists daily quota across restarts.

`schema_migrations` — version, applied_at. Migrations are idempotent.

The configured embedding dimension is asserted against the schema at startup.

## 5. Provider abstraction

```ts
interface LlmProvider {
  readonly name: string
  generate(req: { system: string; user: string; maxTokens: number; temperature: number })
    : Promise<{ text: string; inputTokens: number; outputTokens: number }>
}

interface EmbeddingProvider {
  readonly name: string
  readonly model: string
  readonly dimensions: number
  embedDocuments(texts: string[]): Promise<number[][]>
  embedQuery(text: string): Promise<number[]>
}
```

Documents embed with task type `RETRIEVAL_DOCUMENT`, queries with `RETRIEVAL_QUERY`. That asymmetry is what
makes paraphrased questions retrieve well.

Registries map a provider name to a factory, so provider choice is config, not code — and later, a dropdown.

Offline implementations (`stub`, `deterministic`) ship as first-class so the whole test suite runs with no key
and no network.

## 6. Credential pools and rotation

A pool implements the *same interface* as a single provider. Nothing downstream knows it exists.

**Credential state:** `HEALTHY → COOLING` on 429 or local budget reached; `COOLING → HEALTHY` when the cooldown
expires (`Retry-After` when supplied, else configured backoff); `HEALTHY → DEAD` on 401/403, terminal;
5xx retries in place twice before rotating.

**Two mechanisms, both required.** Providers expose no quota-balance endpoint, so:
- *Predict* — local counters per credential (RPM, TPM, RPD) skip a credential that is already spent, costing
  no latency and no quota.
- *Correct* — 429 handling catches the cases prediction misses (clock drift, shared keys, changed limits).

Ordering is by `priority`, round-robin within a tier. All credentials exhausted → typed
`AllProvidersExhaustedError`, never a hang.

**Hard constraint:** embedding pools may rotate across *keys* but never across *models*. Mixed-model embedding
pools fail startup with a `ConfigError`. Rationale: the corpus lives in one model's vector space; cross-model
failover makes every similarity score meaningless and does so silently.

**Quota events:** `quota.approaching` (80% of daily cap, WARN), `key.cooling` (WARN), `key.dead` (ERROR),
`pool.exhausted` (CRITICAL). Exposed at `GET /admin/providers` and in the log stream.

## 7. Chunking

Pure function. Paragraph-aware, target ~1000 characters with ~150 overlap, preferring sentence boundaries,
never emitting an empty or whitespace-only chunk. Deterministic — same input, same chunks.

## 8. Retrieval and the relevance gate

Search converts pgvector cosine distance to similarity (`1 - distance`), returns top-N with scores.

The gate is a pure function returning a decision object:

- `topScore >= MIN_TOP_SIMILARITY` (default `0.62`) — else refuse
- keep chunks scoring `>= MIN_CHUNK_SIMILARITY` (default `0.55`), cap at `MAX_CONTEXT_CHUNKS` (default `5`)
- require at least one surviving chunk

**Below threshold, no LLM call is made.** The refusal is structural, not a behaviour the model is trusted to
produce.

## 9. Grounded generation

Retrieved chunks are wrapped in delimiters and explicitly labelled untrusted data. The system prompt states
that any instructions appearing inside the context are content to be reported on, never commands to follow.
The model must answer only from context and emit a sentinel when the context is insufficient; the sentinel maps
back to the same canonical refusal string.

Three layers of injection defence: the gate blocks off-topic injections before retrieval matters, the prompt
seals context from instruction, and the sentinel catches the remainder.

Responses carry citations (document slug, title, chunk index, score).

## 10. Errors, logging, trace

Typed hierarchy: `AppError` → `ConfigError`, `DatabaseError`, `ProviderError`, `RateLimitError`,
`AllProvidersExhaustedError`, `ValidationError`. Each carries a stable `code` and an HTTP status.

Structured JSON logger, levels, request-scoped child loggers with a request id.

Every ask logs a full retrieval trace: query, chunk ids, scores, gate decision and reason, provider used,
token counts, latency. Without it, retrieval quality is unfalsifiable.

## 11. Verification

| Category | Expected | Proves |
|---|---|---|
| Direct question | Grounded answer + citations | Retrieval and generation work |
| Paraphrased | Same source retrieved | Semantic search, not keyword luck |
| Unrelated | Refusal, no model call | The gate holds |
| Partially related | Refusal despite topical overlap | Adjacency is not evidence |
| Prompt injection | Refusal or grounded deflection | Retrieved text is data, not instruction |

Unit tests (no DB, no network): chunker, gate, prompt builder, refusal path, quota math, rotation state machine,
config validation including the mixed-model rejection.

Integration tests (pgvector in Docker, stub providers): migrations, repositories, similarity search ordering,
full ask flow across all five categories.

Live smoke script exercises real Gemini calls when `GEMINI_API_KEY` is present.

## 12. Seed corpus

Ten cybersecurity topics: SQL injection, XSS, phishing, ransomware, MFA, zero trust, incident response,
password security, network firewalls, and social engineering. Markdown with frontmatter, sized so each yields
multiple chunks.

Deliberately excluded: compliance and audit scheduling. That gap is what the "partially related" test exploits.

## 13. Explicitly out of scope

Admin dashboard, chat UI, multi-turn conversation state, query rewriting, hybrid search fusion, reranking,
evaluation harness, semantic caching, streaming, authentication.
