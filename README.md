# grounded

A retrieval-augmented cybersecurity assistant that answers **only** from its own knowledge base, cites what
it used, and refuses deterministically when the knowledge base does not cover the question.

The refusal is decided in code, before any model is contacted — not requested of the model in a prompt.

- Architecture walkthrough: [`docs/phase1-architecture.html`](docs/phase1-architecture.html)
- Design spec: [`docs/superpowers/specs/2026-08-09-phase1-rag-pipeline-design.md`](docs/superpowers/specs/2026-08-09-phase1-rag-pipeline-design.md)

## Requirements

Node 22.6+ (24 recommended) and Docker. TypeScript runs directly through Node's native type stripping —
there is no build step. Two runtime dependencies: `pg` and `@google/genai`.

## Quick start — offline, no API key

Everything runs with no credentials using the built-in offline providers.

```bash
npm install
npm run db:up                     # Postgres 17 + pgvector on port 5433

export DATABASE_URL="postgres://grounded:grounded@localhost:5433/grounded"
export LLM_POOL=stub EMBEDDING_POOL=deterministic
export MIN_TOP_SIMILARITY=0.22 MIN_CHUNK_SIMILARITY=0.18

npm run migrate
npm run seed
npm run verify                    # runs the acceptance scenarios
npm start                         # http://localhost:3000
```

The offline embedding provider is hashed bag-of-words, not a neural model. It gives real lexical similarity —
enough to exercise retrieval, the gate, refusal and citations deterministically — but it has no semantics, so
its thresholds are much lower than a real model's. See *Thresholds* below.

## Live run with Gemini

Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey), then:

```bash
cp .env.example .env
# set GEMINI_API_KEYS=key1,key2,key3   (as many as you have)
# leave LLM_POOL=gemini and EMBEDDING_POOL=gemini

npm run migrate && npm run seed && npm run verify
```

Switching embedding models changes the vector space, so the corpus must be re-seeded. Drop the volume with
`npm run db:down && docker volume rm chatbot_grounded-pgdata` before re-seeding with a different model.

## Endpoints

| Route | Purpose |
|---|---|
| `POST /ask` | `{"question": "..."}` → answer with citations, or the canonical refusal |
| `GET /health` | Database reachability and pool state |
| `GET /admin/providers` | Per-credential quota, health, cooldowns, and recent events |

```bash
curl -s -X POST localhost:3000/ask -H 'content-type: application/json' \
  -d '{"question":"What is SQL injection?"}'
```

## Multiple API keys and rotation

List as many keys per provider as you have. Each becomes an independent rotation slot with its own counters.

```bash
GEMINI_API_KEYS=key1,key2,key3
LLM_POOL=gemini,openai        # every Gemini key is exhausted before OpenAI is touched
EMBEDDING_POOL=gemini
```

A credential moves `HEALTHY → COOLING` on a 429 or when its local budget is spent, returns automatically when
the cooldown elapses, and moves to `DEAD` permanently on 401/403. Because no provider exposes a
quota-balance endpoint, the pool counts locally to skip a spent key *without sending a request*, and handles
429s to correct when that prediction is wrong. Daily counters persist in Postgres so a restart does not grant
a fresh day's allowance.

**Embedding pools may rotate across keys but never across models.** Listing two different embedding providers
is rejected at startup: the corpus lives in one model's vector space, and mixing them makes every similarity
score meaningless without raising any error. LLM pools have no such restriction.

Operational events — `quota.approaching` (80% of daily cap), `key.cooling`, `key.dead`, `pool.exhausted` —
appear in the log stream and at `GET /admin/providers`.

## Thresholds

The gate compares the best chunk's cosine similarity against `MIN_TOP_SIMILARITY`. **This value is a property
of the embedding model, not a universal constant.** After changing models, re-calibrate:

```bash
node scripts/calibrate.ts
```

It prints the score every acceptance scenario produces, grouped by whether it should be answered or refused,
and suggests a threshold in the gap between the two groups.

## Tests

```bash
npm test              # 145 tests
npm run test:unit     # no database, no network
npm run test:integration
```

Unit tests cover chunking, the gate, config validation, quota arithmetic, rotation state transitions, prompt
construction and the refusal paths. Integration tests run the whole pipeline against real pgvector with the
offline providers.

## Layout

```
src/config/        env parsing, pool composition, validation
src/providers/     LLM and embedding providers + the credential pool
src/ingest/        chunker (pure) and ingestion
src/retrieval/     vector search and the relevance gate (pure)
src/rag/           prompt construction and grounded answering
src/server/        HTTP surface
seed/              12 cybersecurity topics
scripts/           migrate · seed · ask · verify · calibrate
```

## Scope

Phase 1 is the retrieval spine. Deliberately not built yet: admin dashboard, chat UI, multi-turn conversation
state, query rewriting, hybrid search fusion, reranking, evaluation harness, semantic caching, and
authentication. The `tsvector` column ships now because adding it later would mean re-embedding every chunk.
