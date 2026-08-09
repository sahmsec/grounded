/**
 * Integration tests get their own database.
 *
 * They truncate and re-seed on every run, so pointing them at the development
 * database destroys whatever is indexed there — and silently, because the
 * schema is identical and only the vectors differ. That is exactly how a
 * Gemini-embedded corpus once got replaced with offline vectors mid-session,
 * leaving similarity scores near zero with nothing in the logs to explain it.
 */

import pg from 'pg';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://grounded:grounded@localhost:5433/grounded_test';

/** Creates the test database if it is not there yet. Safe to call repeatedly. */
export async function ensureTestDatabase(url = TEST_DATABASE_URL): Promise<void> {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.replace(/^\//, ''));

  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Refusing to create a database with an unsafe name: ${name}`);
  }
  if (!/test/i.test(name)) {
    // A guard against exactly the accident this module exists to prevent.
    throw new Error(
      `TEST_DATABASE_URL must point at a database whose name contains "test", got "${name}". ` +
        'Integration tests delete all rows on every run.',
    );
  }

  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';

  const client = new pg.Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await client.end();
  }
}
