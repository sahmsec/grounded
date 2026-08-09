/**
 * Migration runner.
 *
 * Idempotent and safe to re-run: applied versions are recorded, and each file
 * runs inside its own transaction so a failure leaves no partial schema.
 */

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { DatabaseError } from '../errors/index.ts';
import type { Logger } from '../logging/logger.ts';
import { query, withTransaction, type Db } from './client.ts';

export interface MigrateOptions {
  db: Db;
  directory: string;
  logger: Logger;
  /** Values substituted into `{{TOKEN}}` placeholders before execution. */
  substitutions?: Record<string, string | number>;
}

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    checksum   TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

function substitute(sql: string, substitutions: Record<string, string | number>): string {
  return sql.replace(/\{\{(\w+)\}\}/g, (match, token: string) => {
    const value = substitutions[token];
    if (value === undefined) {
      throw new DatabaseError(`Migration references unknown placeholder ${match}`, { token });
    }
    return String(value);
  });
}

export async function runMigrations(options: MigrateOptions): Promise<string[]> {
  const { db, directory, logger } = options;
  const substitutions = options.substitutions ?? {};

  await query(db, MIGRATIONS_TABLE);

  const entries = await readdir(directory);
  const files = entries.filter((name) => name.endsWith('.sql')).sort();

  const applied = await query<{ version: string; checksum: string }>(
    db,
    'SELECT version, checksum FROM schema_migrations',
  );
  const appliedByVersion = new Map(applied.map((row) => [row.version, row.checksum]));

  const executed: string[] = [];

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const raw = await readFile(path.join(directory, file), 'utf8');
    const sql = substitute(raw, substitutions);
    const checksum = createHash('sha256').update(sql).digest('hex').slice(0, 16);

    const previous = appliedByVersion.get(version);
    if (previous !== undefined) {
      if (previous !== checksum) {
        // Silently ignoring this would let the database and the repository
        // drift apart with no signal at all.
        logger.warn('migration.checksum_mismatch', {
          version,
          applied: previous,
          current: checksum,
          hint: 'Migration file changed after being applied. Recreate the database or add a new migration.',
        });
      }
      continue;
    }

    logger.info('migration.applying', { version });
    await withTransaction(db, async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
        version,
        checksum,
      ]);
    });
    executed.push(version);
  }

  logger.info('migration.complete', { applied: executed.length, total: files.length });
  return executed;
}

/**
 * Confirms the stored vector column matches the configured embedding size.
 *
 * A mismatch means every insert would fail, or worse, that the corpus was
 * built with a different model than the one now configured.
 */
export async function assertEmbeddingDimensions(db: Db, expected: number): Promise<void> {
  const rows = await query<{ dimensions: number | null }>(
    db,
    `SELECT atttypmod AS dimensions
       FROM pg_attribute
      WHERE attrelid = 'document_chunks'::regclass
        AND attname = 'embedding'`,
  );

  const actual = rows[0]?.dimensions;
  if (actual == null || actual < 0) return; // Column is untyped or missing; migrations will report it.

  if (actual !== expected) {
    throw new DatabaseError(
      `document_chunks.embedding is vector(${actual}) but EMBEDDING_DIMENSIONS is ${expected}. ` +
        `Re-create the database or restore the previous embedding configuration.`,
      { actual, expected },
    );
  }
}

/**
 * Confirms the indexed corpus was built by the embedding model now configured.
 *
 * Matching dimensions are not enough. Two different models can both produce
 * 768-dimension vectors that are completely incomparable, and the failure is
 * silent: no error, no crash, just similarity scores near zero and a bot that
 * refuses everything. This turns that into a startup error naming the fix.
 */
export async function assertEmbeddingModel(db: Db, expected: string): Promise<void> {
  const rows = await query<{ embedding_model: string; count: string }>(
    db,
    `SELECT embedding_model, count(*)::text AS count
       FROM document_chunks
      GROUP BY embedding_model`,
  );

  if (rows.length === 0) return; // Empty corpus; nothing to disagree with.

  const foreign = rows.filter((row) => row.embedding_model !== expected);
  if (foreign.length === 0) return;

  const summary = foreign.map((row) => `${row.embedding_model} (${row.count} chunks)`).join(', ');
  throw new DatabaseError(
    `The corpus was indexed with ${summary}, but EMBEDDING_POOL is configured for "${expected}". ` +
      `Those vectors are not comparable, so every question would score near zero and be refused. ` +
      `Re-index with: npm run seed -- --force`,
    { expected, found: rows.map((row) => row.embedding_model) },
  );
}
