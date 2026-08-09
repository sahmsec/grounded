import { describe, expect, it } from 'vitest';
import { loadConfig, type Env } from '../../src/config/index.ts';
import { ConfigError } from '../../src/errors/index.ts';

const BASE: Env = {
  DATABASE_URL: 'postgres://user:pass@localhost:5433/db',
  GEMINI_API_KEYS: 'key-one',
  LLM_POOL: 'gemini',
  EMBEDDING_POOL: 'gemini',
};

describe('loadConfig', () => {
  it('expands one key per credential slot, in pool order', () => {
    const config = loadConfig({ ...BASE, GEMINI_API_KEYS: 'a,b,c' });

    expect(config.llm.pool.map((credential) => credential.id)).toEqual([
      'gemini#1',
      'gemini#2',
      'gemini#3',
    ]);
    expect(config.llm.pool.map((credential) => credential.priority)).toEqual([0, 1, 2]);
    expect(config.llm.pool[1]!.apiKey).toBe('b');
  });

  it('drains every key of the first provider before the second', () => {
    const config = loadConfig({
      ...BASE,
      GEMINI_API_KEYS: 'g1,g2',
      OPENAI_API_KEYS: 'o1',
      LLM_POOL: 'gemini,openai',
    });

    expect(config.llm.pool.map((credential) => credential.id)).toEqual([
      'gemini#1',
      'gemini#2',
      'openai#1',
    ]);
  });

  it('rejects an embedding pool that spans more than one model', () => {
    // The central safety rule: cross-model rotation would put the corpus and
    // the queries in different vector spaces and fail silently.
    expect(() =>
      loadConfig({ ...BASE, OPENAI_API_KEYS: 'o1', EMBEDDING_POOL: 'gemini,openai' }),
    ).toThrow(ConfigError);

    try {
      loadConfig({ ...BASE, OPENAI_API_KEYS: 'o1', EMBEDDING_POOL: 'gemini,openai' });
    } catch (error) {
      expect((error as ConfigError).message).toContain('vector spaces');
    }
  });

  it('allows many keys for one embedding model', () => {
    const config = loadConfig({ ...BASE, GEMINI_API_KEYS: 'a,b,c', EMBEDDING_POOL: 'gemini' });

    expect(config.embedding.pool).toHaveLength(3);
    expect(config.embedding.model).toBe('gemini-embedding-001');
  });

  it('rejects a pool naming a provider with no keys', () => {
    expect(() => loadConfig({ ...BASE, LLM_POOL: 'openai' })).toThrow(/OPENAI_API_KEYS is empty/);
  });

  it('rejects an unknown provider', () => {
    expect(() => loadConfig({ ...BASE, LLM_POOL: 'nonesuch' })).toThrow(/Unknown llm provider/);
  });

  it('needs no credentials for the offline providers', () => {
    const config = loadConfig({
      DATABASE_URL: BASE.DATABASE_URL,
      LLM_POOL: 'stub',
      EMBEDDING_POOL: 'deterministic',
    });

    expect(config.llm.pool).toHaveLength(1);
    expect(config.embedding.model).toBe('deterministic-v1');
  });

  it('rejects a content floor above the gate', () => {
    expect(() =>
      loadConfig({ ...BASE, MIN_TOP_SIMILARITY: '0.5', MIN_CHUNK_SIMILARITY: '0.9' }),
    ).toThrow(/cannot exceed/);
  });

  it('rejects similarity thresholds outside 0 to 1', () => {
    expect(() => loadConfig({ ...BASE, MIN_TOP_SIMILARITY: '1.5' })).toThrow(/between 0 and 1/);
  });

  it('rejects a candidate limit smaller than the context cap', () => {
    expect(() => loadConfig({ ...BASE, CANDIDATE_LIMIT: '2', MAX_CONTEXT_CHUNKS: '5' })).toThrow(
      /at least MAX_CONTEXT_CHUNKS/,
    );
  });

  it('rejects chunk overlap that would never advance', () => {
    expect(() => loadConfig({ ...BASE, CHUNK_SIZE: '500', CHUNK_OVERLAP: '500' })).toThrow(
      /must be smaller than CHUNK_SIZE/,
    );
  });

  it('rejects a non-numeric integer setting rather than silently defaulting', () => {
    expect(() => loadConfig({ ...BASE, PORT: 'abc' })).toThrow(/must be an integer/);
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ ...BASE, LOG_LEVEL: 'chatty' })).toThrow(/LOG_LEVEL/);
  });

  it('reads per-provider quota limits onto every credential of that provider', () => {
    const config = loadConfig({ ...BASE, GEMINI_API_KEYS: 'a,b', GEMINI_RPM: '10', GEMINI_RPD: '250' });

    for (const credential of config.llm.pool) {
      expect(credential.limits.rpm).toBe(10);
      expect(credential.limits.rpd).toBe(250);
      expect(credential.limits.tpm).toBeNull();
    }
  });

  it('applies documented defaults when optional settings are absent', () => {
    const config = loadConfig(BASE);

    expect(config.gate).toEqual({
      minTopSimilarity: 0.62,
      minChunkSimilarity: 0.55,
      maxContextChunks: 5,
      candidateLimit: 20,
    });
    expect(config.embedding.dimensions).toBe(768);
    expect(config.port).toBe(3000);
  });
});
