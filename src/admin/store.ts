/** Reads and writes admin-managed credentials and settings. */

import type { Config, CredentialConfig } from '../config/index.ts';
import { query, type Db } from '../db/client.ts';
import { NotFoundError, ValidationError } from '../errors/index.ts';
import { hintFor, type Cipher } from './crypto.ts';

export const SETTING_KEYS = {
  llmProvider: 'llm.provider',
  llmModel: 'llm.model',
  embeddingProvider: 'embedding.provider',
  embeddingModel: 'embedding.model',
} as const;

export interface CredentialRow {
  id: string;
  provider: string;
  label: string;
  hint: string;
  priority: number;
  enabled: boolean;
  createdAt: Date;
}

export interface ActiveSettings {
  llmProvider: string;
  llmModel: string;
  embeddingProvider: string;
  embeddingModel: string;
}

export class AdminStore {
  private readonly db: Db;
  private readonly cipher: Cipher;

  constructor(db: Db, cipher: Cipher) {
    this.db = db;
    this.cipher = cipher;
  }

  async audit(action: string, detail: Record<string, unknown> = {}): Promise<void> {
    await query(this.db, 'INSERT INTO admin_audit (action, detail) VALUES ($1, $2::jsonb)', [
      action,
      JSON.stringify(detail),
    ]);
  }

  /** Never returns secrets — only enough to identify each key. */
  async listCredentials(): Promise<CredentialRow[]> {
    const rows = await query<{
      id: string;
      provider: string;
      label: string;
      hint: string;
      priority: number;
      enabled: boolean;
      created_at: Date;
    }>(
      this.db,
      `SELECT id, provider, label, hint, priority, enabled, created_at
         FROM provider_credentials ORDER BY provider, priority, created_at`,
    );

    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      label: row.label,
      hint: row.hint,
      priority: row.priority,
      enabled: row.enabled,
      createdAt: row.created_at,
    }));
  }

  async addCredential(input: { provider: string; label: string; secret: string }): Promise<CredentialRow> {
    const secret = input.secret.trim();
    if (secret.length < 8) throw new ValidationError('That does not look like an API key');

    const label = input.label.trim() || `${input.provider} key`;

    const rows = await query<{ id: string; created_at: Date; priority: number }>(
      this.db,
      `INSERT INTO provider_credentials (provider, label, secret, hint, priority)
            VALUES ($1, $2, $3, $4,
                    COALESCE((SELECT max(priority) + 1 FROM provider_credentials WHERE provider = $1), 0))
       ON CONFLICT (provider, label) DO UPDATE
               SET secret = EXCLUDED.secret, hint = EXCLUDED.hint, enabled = true
         RETURNING id, created_at, priority`,
      [input.provider, label, this.cipher.encrypt(secret), hintFor(secret)],
    );

    const row = rows[0]!;
    await this.audit('credential.added', { provider: input.provider, label, hint: hintFor(secret) });

    return {
      id: row.id,
      provider: input.provider,
      label,
      hint: hintFor(secret),
      priority: row.priority,
      enabled: true,
      createdAt: row.created_at,
    };
  }

  async setCredentialEnabled(id: string, enabled: boolean): Promise<void> {
    const rows = await query<{ label: string }>(
      this.db,
      'UPDATE provider_credentials SET enabled = $2 WHERE id = $1 RETURNING label',
      [id, enabled],
    );
    if (rows.length === 0) throw new NotFoundError('No such credential');
    await this.audit(enabled ? 'credential.enabled' : 'credential.disabled', { id, label: rows[0]!.label });
  }

  async removeCredential(id: string): Promise<void> {
    const rows = await query<{ label: string; provider: string }>(
      this.db,
      'DELETE FROM provider_credentials WHERE id = $1 RETURNING label, provider',
      [id],
    );
    if (rows.length === 0) throw new NotFoundError('No such credential');
    await this.audit('credential.removed', { id, ...rows[0] });
  }

  /** Decrypts one key. Used only to make a provider call, never to display. */
  async secretFor(id: string): Promise<string> {
    const rows = await query<{ secret: string }>(
      this.db,
      'SELECT secret FROM provider_credentials WHERE id = $1',
      [id],
    );
    if (rows.length === 0) throw new NotFoundError('No such credential');
    return this.cipher.decrypt(rows[0]!.secret);
  }

  /** Enabled credentials for a provider, decrypted and ordered for a pool. */
  async credentialsFor(provider: string, limits: CredentialConfig['limits']): Promise<CredentialConfig[]> {
    const rows = await query<{ id: string; label: string; secret: string; priority: number }>(
      this.db,
      `SELECT id, label, secret, priority
         FROM provider_credentials
        WHERE provider = $1 AND enabled = true
        ORDER BY priority, created_at`,
      [provider],
    );

    return rows.map((row, index) => ({
      id: `${provider}#${row.label}`,
      provider,
      apiKey: this.cipher.decrypt(row.secret),
      priority: index,
      limits,
    }));
  }

  async settings(fallback: ActiveSettings): Promise<ActiveSettings> {
    const rows = await query<{ key: string; value: string }>(this.db, 'SELECT key, value FROM app_settings');
    const stored = new Map(rows.map((row) => [row.key, row.value]));

    return {
      llmProvider: stored.get(SETTING_KEYS.llmProvider) ?? fallback.llmProvider,
      llmModel: stored.get(SETTING_KEYS.llmModel) ?? fallback.llmModel,
      embeddingProvider: stored.get(SETTING_KEYS.embeddingProvider) ?? fallback.embeddingProvider,
      embeddingModel: stored.get(SETTING_KEYS.embeddingModel) ?? fallback.embeddingModel,
    };
  }

  async saveSettings(values: Partial<ActiveSettings>): Promise<void> {
    const entries = Object.entries(values).filter(([, value]) => typeof value === 'string' && value.length);
    for (const [name, value] of entries) {
      const key = SETTING_KEYS[name as keyof ActiveSettings];
      if (!key) continue;
      await query(
        this.db,
        `INSERT INTO app_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, value as string],
      );
    }
    await this.audit('settings.updated', values as Record<string, unknown>);
  }

  /**
   * One-time import so keys already in .env keep working after the admin
   * tables arrive. Runs only when the store is empty, so it never overwrites
   * anything an operator has since changed on the screen.
   */
  async importFromEnv(config: Config): Promise<number> {
    const existing = await query<{ count: string }>(
      this.db,
      'SELECT count(*)::text AS count FROM provider_credentials',
    );
    if (Number(existing[0]?.count ?? 0) > 0) return 0;

    const seen = new Set<string>();
    const seeds = [...config.llm.pool, ...config.embedding.pool].filter((credential) => {
      if (!credential.apiKey || seen.has(credential.apiKey)) return false;
      seen.add(credential.apiKey);
      return true;
    });

    for (const [index, credential] of seeds.entries()) {
      await this.addCredential({
        provider: credential.provider,
        label: `imported ${index + 1}`,
        secret: credential.apiKey,
      });
    }

    return seeds.length;
  }
}
