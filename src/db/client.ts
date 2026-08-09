/** Postgres connection handling and query helpers. */

import pg from 'pg';
import { DatabaseError } from '../errors/index.ts';
import type { Logger } from '../logging/logger.ts';

const { Pool } = pg;

export type Db = pg.Pool;

export interface DbOptions {
  connectionString: string;
  max?: number;
  logger?: Logger;
}

export function createDb(options: DbOptions): Db {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    // A hung connection should fail fast rather than stall a request.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

  // An idle client erroring out is not tied to any query, so without this
  // handler it would surface as an unhandled 'error' event and kill the process.
  pool.on('error', (err) => {
    options.logger?.error('db.idle_client_error', { err });
  });

  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  db: Db,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  try {
    const result = await db.query<T>(text, values);
    return result.rows;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new DatabaseError(`Query failed: ${message}`, { sql: text.slice(0, 200) }, { cause });
  }
}

export async function withTransaction<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (cause) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The rollback itself failing means the connection is gone; the original
      // error is the useful one, so it is preserved below.
    }
    if (cause instanceof DatabaseError) throw cause;
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new DatabaseError(`Transaction rolled back: ${message}`, {}, { cause });
  } finally {
    client.release();
  }
}

export async function ping(db: Db): Promise<boolean> {
  try {
    await db.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * pgvector accepts a bracketed literal over the wire. Guarding against
 * non-finite values here keeps a NaN from becoming an unsearchable row.
 */
export function toVectorLiteral(embedding: number[]): string {
  for (const value of embedding) {
    if (!Number.isFinite(value)) {
      throw new DatabaseError('Embedding contains a non-finite value', { value });
    }
  }
  return `[${embedding.join(',')}]`;
}
