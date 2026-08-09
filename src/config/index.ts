/**
 * Configuration loading and validation.
 *
 * Everything that can be wrong is caught here, at startup, rather than at
 * request time. The most important rule this file enforces is that an
 * embedding pool may rotate across KEYS but never across MODELS — see
 * `buildEmbeddingPool` for why that would otherwise fail silently.
 */

import { ConfigError } from '../errors/index.ts';
import { isLogLevel, type LogLevel } from '../logging/logger.ts';
import { isAnswerMode, type AnswerMode } from '../rag/modes.ts';

export interface QuotaLimits {
  /** Requests per minute. `null` means unmetered on that axis. */
  rpm: number | null;
  /** Requests per day. */
  rpd: number | null;
  /** Tokens per minute. */
  tpm: number | null;
}

export interface CredentialConfig {
  /** Stable identifier, e.g. `gemini#1`. Used as the quota-tracking key. */
  id: string;
  provider: string;
  apiKey: string;
  /** Lower is tried first. Derived from position in the pool list. */
  priority: number;
  limits: QuotaLimits;
}

export interface Config {
  databaseUrl: string;
  port: number;
  logLevel: LogLevel;
  llm: {
    pool: CredentialConfig[];
    /** Model id per provider name. */
    models: Record<string, string>;
    maxOutputTokens: number;
    temperature: number;
    /**
     * Model used to turn follow-ups into standalone questions. Deliberately a
     * small one: free-tier quota is counted per model, so a mechanical rewrite
     * should not consume the answering model's daily allowance.
     */
    rewriteModel: string;
    /**
     * Whether facts must come from the corpus, or the corpus only fixes the
     * topic. The gate is unaffected either way.
     */
    answerMode: AnswerMode;
  };
  embedding: {
    pool: CredentialConfig[];
    /** Single model for the whole pool — enforced, not assumed. */
    model: string;
    dimensions: number;
  };
  gate: {
    minTopSimilarity: number;
    minChunkSimilarity: number;
    maxContextChunks: number;
    candidateLimit: number;
  };
  chunking: {
    size: number;
    overlap: number;
  };
  quota: {
    warnRatio: number;
    defaultCooldownMs: number;
  };
}

export type Env = Record<string, string | undefined>;

const LLM_PROVIDERS = new Set(['gemini', 'openai', 'stub']);
const EMBEDDING_PROVIDERS = new Set(['gemini', 'openai', 'deterministic']);
/** Providers that run entirely in-process and therefore need no credential. */
const OFFLINE_PROVIDERS = new Set(['stub', 'deterministic']);

// --- primitive readers -----------------------------------------------------

function str(env: Env, key: string, fallback?: string): string {
  const raw = env[key]?.trim();
  if (raw) return raw;
  if (fallback !== undefined) return fallback;
  throw new ConfigError(`Missing required environment variable ${key}`, { key });
}

function int(env: Env, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new ConfigError(`${key} must be an integer, received "${raw}"`, { key, value: raw });
  }
  return parsed;
}

function num(env: Env, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new ConfigError(`${key} must be a number, received "${raw}"`, { key, value: raw });
  }
  return parsed;
}

function list(env: Env, key: string, fallback: string[] = []): string[] {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function optionalLimit(env: Env, key: string): number | null {
  const raw = env[key]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${key} must be a positive integer, received "${raw}"`, { key, value: raw });
  }
  return parsed;
}

// --- credential assembly ---------------------------------------------------

function limitsFor(env: Env, provider: string): QuotaLimits {
  const prefix = provider.toUpperCase();
  return {
    rpm: optionalLimit(env, `${prefix}_RPM`),
    rpd: optionalLimit(env, `${prefix}_RPD`),
    tpm: optionalLimit(env, `${prefix}_TPM`),
  };
}

/**
 * Expands an ordered provider list into a flat, ordered credential list.
 * Every key of provider N is exhausted before provider N+1 is touched, which
 * is what makes "drain the free tier first" work.
 */
function expandCredentials(env: Env, providers: string[], poolName: string): CredentialConfig[] {
  const credentials: CredentialConfig[] = [];

  for (const provider of providers) {
    if (OFFLINE_PROVIDERS.has(provider)) {
      credentials.push({
        id: `${provider}#1`,
        provider,
        apiKey: '',
        priority: credentials.length,
        limits: { rpm: null, rpd: null, tpm: null },
      });
      continue;
    }

    const keys = list(env, `${provider.toUpperCase()}_API_KEYS`);
    if (keys.length === 0) {
      throw new ConfigError(
        `The ${poolName} pool lists provider "${provider}" but ${provider.toUpperCase()}_API_KEYS is empty`,
        { pool: poolName, provider },
      );
    }

    const limits = limitsFor(env, provider);
    keys.forEach((apiKey, index) => {
      credentials.push({
        id: `${provider}#${index + 1}`,
        provider,
        apiKey,
        priority: credentials.length,
        limits,
      });
    });
  }

  return credentials;
}

function assertKnownProviders(providers: string[], allowed: Set<string>, poolName: string): void {
  if (providers.length === 0) {
    throw new ConfigError(`The ${poolName} pool is empty`, { pool: poolName });
  }
  for (const provider of providers) {
    if (!allowed.has(provider)) {
      throw new ConfigError(
        `Unknown ${poolName} provider "${provider}". Supported: ${[...allowed].join(', ')}`,
        { pool: poolName, provider, supported: [...allowed] },
      );
    }
  }
}

/**
 * Embedding pools are the one place rotation is dangerous.
 *
 * The corpus is indexed into a single model's vector space. Failing over to a
 * different model would produce query vectors that are not comparable to the
 * stored ones — every similarity score becomes noise, and it fails *quietly*:
 * no exception, no log, just confidently wrong grounding. So a pool spanning
 * more than one embedding model is a startup error, never a runtime surprise.
 */
function buildEmbeddingPool(env: Env): { pool: CredentialConfig[]; model: string; dimensions: number } {
  const providers = list(env, 'EMBEDDING_POOL', ['gemini']);
  assertKnownProviders(providers, EMBEDDING_PROVIDERS, 'embedding');

  const distinct = [...new Set(providers)];
  if (distinct.length > 1) {
    throw new ConfigError(
      `An embedding pool may rotate across keys but not across models. ` +
        `EMBEDDING_POOL names ${distinct.length} providers (${distinct.join(', ')}), which would put the ` +
        `corpus and the queries in different vector spaces. Use one provider and list multiple keys instead.`,
      { pool: 'embedding', providers: distinct },
    );
  }

  const provider = distinct[0] as string;
  const models: Record<string, string> = {
    gemini: str(env, 'GEMINI_EMBEDDING_MODEL', 'gemini-embedding-001'),
    openai: str(env, 'OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small'),
    deterministic: 'deterministic-v1',
  };

  const dimensions = int(env, 'EMBEDDING_DIMENSIONS', 768);
  if (dimensions <= 0) {
    throw new ConfigError('EMBEDDING_DIMENSIONS must be a positive integer', { dimensions });
  }

  return {
    pool: expandCredentials(env, providers, 'embedding'),
    model: models[provider] as string,
    dimensions,
  };
}

function readAnswerMode(env: Env): AnswerMode {
  const raw = str(env, 'ANSWER_MODE', 'strict');
  if (!isAnswerMode(raw)) {
    throw new ConfigError(
      `ANSWER_MODE must be "strict" or "topic-locked", received "${raw}"`,
      { value: raw },
    );
  }
  return raw;
}

function buildLlmPool(env: Env): Config['llm'] {
  const providers = list(env, 'LLM_POOL', ['gemini']);
  assertKnownProviders(providers, LLM_PROVIDERS, 'llm');

  return {
    pool: expandCredentials(env, providers, 'llm'),
    models: {
      gemini: str(env, 'GEMINI_LLM_MODEL', 'gemini-2.5-flash'),
      openai: str(env, 'OPENAI_LLM_MODEL', 'gpt-4o-mini'),
      stub: 'stub-v1',
    },
    maxOutputTokens: int(env, 'MAX_OUTPUT_TOKENS', 1024),
    temperature: num(env, 'TEMPERATURE', 0.2),
    rewriteModel: str(env, 'REWRITE_MODEL', ''),
    answerMode: readAnswerMode(env),
  };
}

function buildGate(env: Env): Config['gate'] {
  const minTopSimilarity = num(env, 'MIN_TOP_SIMILARITY', 0.62);
  const minChunkSimilarity = num(env, 'MIN_CHUNK_SIMILARITY', 0.55);
  const maxContextChunks = int(env, 'MAX_CONTEXT_CHUNKS', 5);
  const candidateLimit = int(env, 'CANDIDATE_LIMIT', 20);

  for (const [key, value] of [
    ['MIN_TOP_SIMILARITY', minTopSimilarity],
    ['MIN_CHUNK_SIMILARITY', minChunkSimilarity],
  ] as const) {
    if (value < 0 || value > 1) {
      throw new ConfigError(`${key} must be between 0 and 1, received ${value}`, { key, value });
    }
  }

  if (minChunkSimilarity > minTopSimilarity) {
    throw new ConfigError(
      `MIN_CHUNK_SIMILARITY (${minChunkSimilarity}) cannot exceed MIN_TOP_SIMILARITY (${minTopSimilarity}) — ` +
        `the gate would admit a question and then discard every chunk that justified admitting it`,
      { minChunkSimilarity, minTopSimilarity },
    );
  }

  if (maxContextChunks <= 0) {
    throw new ConfigError('MAX_CONTEXT_CHUNKS must be at least 1', { maxContextChunks });
  }
  if (candidateLimit < maxContextChunks) {
    throw new ConfigError(
      `CANDIDATE_LIMIT (${candidateLimit}) must be at least MAX_CONTEXT_CHUNKS (${maxContextChunks})`,
      { candidateLimit, maxContextChunks },
    );
  }

  return { minTopSimilarity, minChunkSimilarity, maxContextChunks, candidateLimit };
}

function buildChunking(env: Env): Config['chunking'] {
  const size = int(env, 'CHUNK_SIZE', 1000);
  const overlap = int(env, 'CHUNK_OVERLAP', 150);

  if (size <= 0) throw new ConfigError('CHUNK_SIZE must be positive', { size });
  if (overlap < 0) throw new ConfigError('CHUNK_OVERLAP cannot be negative', { overlap });
  if (overlap >= size) {
    throw new ConfigError(
      `CHUNK_OVERLAP (${overlap}) must be smaller than CHUNK_SIZE (${size}) — equal or larger never advances`,
      { size, overlap },
    );
  }

  return { size, overlap };
}

export function loadConfig(env: Env = process.env): Config {
  const logLevelRaw = str(env, 'LOG_LEVEL', 'info');
  if (!isLogLevel(logLevelRaw)) {
    throw new ConfigError(`LOG_LEVEL must be one of debug, info, warn, error — received "${logLevelRaw}"`, {
      value: logLevelRaw,
    });
  }

  const warnRatio = num(env, 'QUOTA_WARN_RATIO', 0.8);
  if (warnRatio <= 0 || warnRatio > 1) {
    throw new ConfigError('QUOTA_WARN_RATIO must be between 0 (exclusive) and 1', { warnRatio });
  }

  return {
    databaseUrl: str(env, 'DATABASE_URL', 'postgres://grounded:grounded@localhost:5433/grounded'),
    port: int(env, 'PORT', 3000),
    logLevel: logLevelRaw,
    llm: buildLlmPool(env),
    embedding: buildEmbeddingPool(env),
    gate: buildGate(env),
    chunking: buildChunking(env),
    quota: {
      warnRatio,
      defaultCooldownMs: int(env, 'DEFAULT_COOLDOWN_MS', 60_000),
    },
  };
}

/**
 * Loads .env if present. Node has this built in, so no dotenv dependency —
 * and a missing file is fine, since real deployments use real env vars.
 */
export function loadEnvFile(path = '.env'): void {
  try {
    process.loadEnvFile(path);
  } catch {
    // No .env file. Environment variables may still be set externally.
  }
}
