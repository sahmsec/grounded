/**
 * Provider construction and the pooled wrappers.
 *
 * A pooled provider implements the same interface as a single one, so the
 * ingestion service and the answer service are written as if exactly one
 * credential existed. Rotation, quota accounting and health tracking all live
 * behind that interface.
 */

import type { Config, CredentialConfig } from '../config/index.ts';
import { ConfigError } from '../errors/index.ts';
import type { Logger } from '../logging/logger.ts';
import { CredentialPool, type PoolEvent, type PoolStatus } from './pool/credential-pool.ts';
import type { UsageStore } from './pool/quota.ts';

import { createGeminiEmbeddings } from './embeddings/gemini.ts';
import { createOpenAiEmbeddings } from './embeddings/openai.ts';
import { createDeterministicEmbeddings } from './embeddings/deterministic.ts';
import type { EmbeddingProvider } from './embeddings/types.ts';

import { createGeminiLlm } from './llm/gemini.ts';
import { createOpenAiLlm } from './llm/openai.ts';
import { createStubLlm } from './llm/stub.ts';
import type { LlmProvider, LlmRequest, LlmResponse } from './llm/types.ts';

export type { EmbeddingProvider } from './embeddings/types.ts';
export type { LlmProvider, LlmRequest, LlmResponse } from './llm/types.ts';
export type { PoolEvent, PoolStatus } from './pool/credential-pool.ts';

/** Gemini accepts up to 100 inputs per embed call; 32 keeps payloads modest. */
const EMBED_BATCH_SIZE = 32;

export interface PooledLlmResponse extends LlmResponse {
  provider: string;
  credentialId: string;
  model: string;
}

export interface PooledLlm {
  generate(request: LlmRequest): Promise<PooledLlmResponse>;
  status(): PoolStatus;
  hydrate(): Promise<void>;
}

export interface PooledEmbeddings extends EmbeddingProvider {
  status(): PoolStatus;
  hydrate(): Promise<void>;
}

// --- single-credential factories -------------------------------------------

function buildLlm(credential: CredentialConfig, models: Record<string, string>): LlmProvider {
  const model = models[credential.provider];
  if (!model) throw new ConfigError(`No LLM model configured for provider "${credential.provider}"`);

  switch (credential.provider) {
    case 'gemini':
      return createGeminiLlm(credential.apiKey, model);
    case 'openai':
      return createOpenAiLlm(credential.apiKey, model);
    case 'stub':
      return createStubLlm(model);
    default:
      throw new ConfigError(`Unsupported LLM provider "${credential.provider}"`);
  }
}

function buildEmbeddings(credential: CredentialConfig, model: string, dimensions: number): EmbeddingProvider {
  switch (credential.provider) {
    case 'gemini':
      return createGeminiEmbeddings(credential.apiKey, model, dimensions);
    case 'openai':
      return createOpenAiEmbeddings(credential.apiKey, model, dimensions);
    case 'deterministic':
      return createDeterministicEmbeddings(dimensions);
    default:
      throw new ConfigError(`Unsupported embedding provider "${credential.provider}"`);
  }
}

// --- pooled wrappers --------------------------------------------------------

export interface PoolDeps {
  logger: Logger;
  usageStore?: UsageStore;
  onEvent?: (event: PoolEvent) => void;
  now?: () => number;
}

export function createPooledLlm(config: Config, deps: PoolDeps): PooledLlm {
  const pool = new CredentialPool({
    name: 'llm',
    credentials: config.llm.pool,
    logger: deps.logger,
    defaultCooldownMs: config.quota.defaultCooldownMs,
    warnRatio: config.quota.warnRatio,
    usageStore: deps.usageStore,
    onEvent: deps.onEvent,
    now: deps.now,
  });

  // One client per credential, created once and reused across calls.
  const instances = new Map<string, LlmProvider>();
  const instanceFor = (credential: CredentialConfig): LlmProvider => {
    let instance = instances.get(credential.id);
    if (!instance) {
      instance = buildLlm(credential, config.llm.models);
      instances.set(credential.id, instance);
    }
    return instance;
  };

  return {
    async generate(request) {
      const result = await pool.execute(async (credential) => {
        const provider = instanceFor(credential);
        const response = await provider.generate(request);
        return {
          value: { ...response, model: provider.model },
          tokens: response.inputTokens + response.outputTokens,
        };
      });

      return { ...result.value, provider: result.provider, credentialId: result.credentialId };
    },
    status: () => pool.status(),
    hydrate: () => pool.hydrate(),
  };
}

export function createPooledEmbeddings(config: Config, deps: PoolDeps): PooledEmbeddings {
  const pool = new CredentialPool({
    name: 'embedding',
    credentials: config.embedding.pool,
    logger: deps.logger,
    defaultCooldownMs: config.quota.defaultCooldownMs,
    warnRatio: config.quota.warnRatio,
    usageStore: deps.usageStore,
    onEvent: deps.onEvent,
    now: deps.now,
  });

  const { model, dimensions } = config.embedding;
  const instances = new Map<string, EmbeddingProvider>();
  const instanceFor = (credential: CredentialConfig): EmbeddingProvider => {
    let instance = instances.get(credential.id);
    if (!instance) {
      instance = buildEmbeddings(credential, model, dimensions);
      instances.set(credential.id, instance);
    }
    return instance;
  };

  // Tokens are estimated rather than reported: embedding endpoints do not
  // return usage, and an undercount would let the TPM budget overrun silently.
  const estimateTokens = (texts: string[]): number =>
    texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);

  return {
    name: 'pooled-embeddings',
    model,
    dimensions,

    async embedDocuments(texts) {
      const output: number[][] = [];

      for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
        const batch = texts.slice(start, start + EMBED_BATCH_SIZE);
        const result = await pool.execute(async (credential) => ({
          value: await instanceFor(credential).embedDocuments(batch),
          tokens: estimateTokens(batch),
        }));
        output.push(...result.value);
      }

      return output;
    },

    async embedQuery(text) {
      const result = await pool.execute(async (credential) => ({
        value: await instanceFor(credential).embedQuery(text),
        tokens: estimateTokens([text]),
      }));
      return result.value;
    },

    status: () => pool.status(),
    hydrate: () => pool.hydrate(),
  };
}
