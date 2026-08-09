/**
 * Composition root.
 *
 * Everything is constructed here and injected downward, so no module reaches
 * for a global. That is what lets the tests build the same graph with stub
 * providers and a throwaway database.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadEnvFile, type Config, type Env } from './config/index.ts';
import { createDb, ping, type Db } from './db/client.ts';
import { assertEmbeddingDimensions, assertEmbeddingModel, runMigrations } from './db/migrate.ts';
import { ChunkRepository, DocumentRepository, createPostgresUsageStore } from './db/repositories.ts';
import { createIngestionService, type IngestionService } from './ingest/service.ts';
import { createLogger, type Logger } from './logging/logger.ts';
import { type PoolEvent, type PoolStatus } from './providers/index.ts';
import { createCipher } from './admin/crypto.ts';
import { AdminStore } from './admin/store.ts';
import { createProviderRuntime, createStaticRuntime, type ProviderRuntime } from './admin/runtime.ts';
import { createAnswerService, type AnswerService } from './rag/answer-service.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
export const SEED_DIR = path.join(ROOT, 'seed');

/** How many recent quota events /admin/providers reports. */
const EVENT_BUFFER_SIZE = 50;

export interface App {
  config: Config;
  logger: Logger;
  db: Db;
  documents: DocumentRepository;
  chunks: ChunkRepository;
  providers: ProviderRuntime;
  admin: AdminStore | null;
  answers: AnswerService;
  ingestion: IngestionService;
  /** Most recent first. Gives an operator the story, not just the state. */
  recentEvents(): Array<PoolEvent & { at: string }>;
  poolStatus(): { llm: PoolStatus; embedding: PoolStatus };
  healthy(): Promise<boolean>;
  close(): Promise<void>;
}

export interface CreateAppOptions {
  env?: Env;
  logger?: Logger;
  /** Runs pending migrations before returning. */
  migrate?: boolean;
}

export async function createApp(options: CreateAppOptions = {}): Promise<App> {
  if (!options.env) loadEnvFile();

  const config = loadConfig(options.env ?? process.env);
  const logger = options.logger ?? createLogger({ level: config.logLevel });

  const db = createDb({ connectionString: config.databaseUrl, logger });

  if (options.migrate !== false) {
    await runMigrations({
      db,
      directory: MIGRATIONS_DIR,
      logger,
      substitutions: { EMBEDDING_DIMENSIONS: config.embedding.dimensions },
    });
  }

  await assertEmbeddingDimensions(db, config.embedding.dimensions);
  await assertEmbeddingModel(db, config.embedding.model);

  const events: Array<PoolEvent & { at: string }> = [];
  const onEvent = (event: PoolEvent): void => {
    events.unshift({ ...event, at: new Date().toISOString() });
    if (events.length > EVENT_BUFFER_SIZE) events.pop();
  };

  const usageStore = createPostgresUsageStore(db);
  const poolDeps = { logger, usageStore, onEvent };

  // The admin store needs a master key. Without one the app still runs
  // entirely from .env — the panel is simply unavailable, rather than the
  // whole service refusing to start over an optional feature.
  let admin: AdminStore | null = null;
  try {
    admin = new AdminStore(db, createCipher(process.env.ADMIN_MASTER_KEY));
    await admin.importFromEnv(config);
  } catch (error) {
    logger.warn('admin.disabled', {
      reason: error instanceof Error ? error.message : String(error),
    });
    admin = null;
  }

  const providers = admin
    ? await createProviderRuntime({ baseConfig: config, store: admin, deps: poolDeps, logger })
    : await createStaticRuntime(config, poolDeps);

  const documents = new DocumentRepository(db);
  const chunks = new ChunkRepository(db);

  const answers = createAnswerService({ config, chunks, providers, logger });
  const ingestion = createIngestionService({ config, documents, chunks, providers, logger });

  logger.info('app.ready', {
    adminPanel: admin ? 'enabled' : 'disabled (no ADMIN_MASTER_KEY)',
    embeddingModel: providers.embeddings.model,
    dimensions: config.embedding.dimensions,
    gate: config.gate,
  });

  return {
    config,
    logger,
    db,
    documents,
    chunks,
    providers,
    admin,
    answers,
    ingestion,
    recentEvents: () => [...events],
    poolStatus: () => ({ llm: providers.llm.status(), embedding: providers.embeddings.status() }),
    healthy: () => ping(db),
    close: async () => {
      await db.end();
    },
  };
}
