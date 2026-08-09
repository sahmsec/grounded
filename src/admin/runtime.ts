/**
 * Live provider wiring.
 *
 * Holds the current pools behind getters so a configuration change swaps them
 * in place. Without this the admin screen would only be able to write settings
 * and ask for a restart, which is not really administration.
 */

import type { Config } from '../config/index.ts';
import { ConfigError } from '../errors/index.ts';
import type { Logger } from '../logging/logger.ts';
import {
  createPooledEmbeddings,
  createPooledLlm,
  type PooledEmbeddings,
  type PooledLlm,
  type PoolDeps,
} from '../providers/index.ts';
import type { ActiveSettings, AdminStore } from './store.ts';

/** What the answer and ingestion services read. Always the current pools. */
export interface ProviderAccess {
  readonly llm: PooledLlm;
  readonly embeddings: PooledEmbeddings;
}

export interface ProviderRuntime extends ProviderAccess {
  settings(): ActiveSettings;
  /** Rebuilds both pools from the database. Safe to call at any time. */
  reload(): Promise<void>;
}

/**
 * Fixed pools built straight from .env, used when the admin panel is off.
 * The service must keep working without a master key; administration is an
 * addition, not a prerequisite.
 */
export async function createStaticRuntime(config: Config, deps: PoolDeps): Promise<ProviderRuntime> {
  const llm = createPooledLlm(config, deps);
  const embeddings = createPooledEmbeddings(config, deps);
  await Promise.all([llm.hydrate(), embeddings.hydrate()]);

  const settings: ActiveSettings = {
    llmProvider: config.llm.pool[0]?.provider ?? 'gemini',
    llmModel: config.llm.models[config.llm.pool[0]?.provider ?? 'gemini'] ?? '',
    embeddingProvider: config.embedding.pool[0]?.provider ?? 'gemini',
    embeddingModel: config.embedding.model,
  };

  return {
    get llm() {
      return llm;
    },
    get embeddings() {
      return embeddings;
    },
    settings: () => settings,
    reload: async () => {
      /* Nothing to reload: configuration is fixed at startup. */
    },
  };
}

export async function createProviderRuntime(options: {
  baseConfig: Config;
  store: AdminStore;
  deps: PoolDeps;
  logger: Logger;
}): Promise<ProviderRuntime> {
  const { baseConfig, store, deps, logger } = options;

  let llm: PooledLlm;
  let embeddings: PooledEmbeddings;
  let current: ActiveSettings;

  async function build(): Promise<void> {
    const fallback: ActiveSettings = {
      llmProvider: baseConfig.llm.pool[0]?.provider ?? 'gemini',
      llmModel: baseConfig.llm.models[baseConfig.llm.pool[0]?.provider ?? 'gemini'] ?? 'gemini-3.6-flash',
      embeddingProvider: baseConfig.embedding.pool[0]?.provider ?? 'gemini',
      embeddingModel: baseConfig.embedding.model,
    };

    const settings = await store.settings(fallback);

    const limitsFor = (provider: string) =>
      baseConfig.llm.pool.find((entry) => entry.provider === provider)?.limits ??
      baseConfig.embedding.pool.find((entry) => entry.provider === provider)?.limits ??
      { rpm: null, rpd: null, tpm: null };

    const llmCredentials = await store.credentialsFor(settings.llmProvider, limitsFor(settings.llmProvider));
    const embeddingCredentials = await store.credentialsFor(
      settings.embeddingProvider,
      limitsFor(settings.embeddingProvider),
    );

    // Offline providers run in-process and need no key, so an empty list is
    // only a problem for the ones that call out.
    const offline = new Set(['stub', 'deterministic']);
    if (llmCredentials.length === 0 && !offline.has(settings.llmProvider)) {
      throw new ConfigError(
        `No enabled API key for "${settings.llmProvider}". Add one in the admin panel before selecting it.`,
        { provider: settings.llmProvider },
      );
    }
    if (embeddingCredentials.length === 0 && !offline.has(settings.embeddingProvider)) {
      throw new ConfigError(
        `No enabled API key for "${settings.embeddingProvider}".`,
        { provider: settings.embeddingProvider },
      );
    }

    const resolved: Config = {
      ...baseConfig,
      llm: {
        ...baseConfig.llm,
        pool: llmCredentials.length > 0 ? llmCredentials : baseConfig.llm.pool,
        models: { ...baseConfig.llm.models, [settings.llmProvider]: settings.llmModel },
      },
      embedding: {
        ...baseConfig.embedding,
        pool: embeddingCredentials.length > 0 ? embeddingCredentials : baseConfig.embedding.pool,
        model: settings.embeddingModel,
      },
    };

    llm = createPooledLlm(resolved, deps);
    embeddings = createPooledEmbeddings(resolved, deps);
    await Promise.all([llm.hydrate(), embeddings.hydrate()]);
    current = settings;

    logger.info('providers.loaded', {
      llm: `${settings.llmProvider}/${settings.llmModel}`,
      embedding: `${settings.embeddingProvider}/${settings.embeddingModel}`,
      llmKeys: resolved.llm.pool.length,
      embeddingKeys: resolved.embedding.pool.length,
    });
  }

  await build();

  return {
    get llm() {
      return llm;
    },
    get embeddings() {
      return embeddings;
    },
    settings: () => current,
    reload: build,
  };
}
