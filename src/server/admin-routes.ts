/**
 * Admin API.
 *
 * Every route here is behind a shared token. This screen reads and writes API
 * credentials, so an unauthenticated version would be strictly worse than
 * keeping keys in .env — it would publish them over HTTP. When the app grows
 * real user accounts, replace `authorised` and nothing else changes.
 */

import { timingSafeEqual } from 'node:crypto';
import type http from 'node:http';
import type { App } from '../app.ts';
import { toAppError, ValidationError } from '../errors/index.ts';
import type { Logger } from '../logging/logger.ts';
import { listModels } from '../admin/models.ts';

function send(response: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

/** Constant-time compare, so the token cannot be recovered by timing. */
function tokenMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorised(request: http.IncomingMessage): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || expected.length < 8) return false;

  const header = request.headers['x-admin-token'];
  const supplied = Array.isArray(header) ? header[0] : header;
  return typeof supplied === 'string' && tokenMatches(supplied, expected);
}

async function readBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new ValidationError('Request body is not valid JSON');
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`"${field}" is required`);
  }
  return value.trim();
}

/** Returns true when the route was handled. */
export async function handleAdmin(
  app: App,
  request: http.IncomingMessage,
  response: http.ServerResponse,
  route: string,
  url: URL,
  logger: Logger,
): Promise<boolean> {
  // Pool status stays open: it exposes health, never secrets, and the chat UI
  // and uptime checks both read it.
  if (route === 'GET /admin/providers') {
    send(response, 200, { pools: app.poolStatus(), recentEvents: app.recentEvents() });
    return true;
  }

  if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.length < 8) {
    send(response, 503, {
      error: 'admin_disabled',
      message:
        'Set ADMIN_TOKEN (16+ characters) and ADMIN_MASTER_KEY in .env to enable the admin panel, then restart.',
    });
    return true;
  }

  if (!authorised(request)) {
    send(response, 401, { error: 'unauthorised', message: 'Invalid or missing admin token.' });
    return true;
  }

  const store = app.admin;
  if (!store) {
    send(response, 503, {
      error: 'admin_disabled',
      message: 'ADMIN_MASTER_KEY is not set, so credentials cannot be stored securely.',
    });
    return true;
  }

  try {
    if (route === 'GET /admin/state') {
      send(response, 200, {
        settings: app.providers.settings(),
        credentials: await store.listCredentials(),
        pools: app.poolStatus(),
        recentEvents: app.recentEvents(),
        corpus: {
          documents: await app.documents.count(),
          chunks: await app.chunks.count(),
          embeddingModel: app.providers.embeddings.model,
        },
        gate: app.config.gate,
      });
      return true;
    }

    if (route === 'GET /admin/models') {
      const provider = url.searchParams.get('provider') ?? 'gemini';
      const credentials = await store.listCredentials();
      const usable = credentials.find((entry) => entry.provider === provider && entry.enabled);

      if (!usable) {
        send(response, 200, { models: [], note: `Add an API key for "${provider}" first.` });
        return true;
      }

      const models = await listModels(provider, await store.secretFor(usable.id));
      send(response, 200, { models });
      return true;
    }

    if (route === 'POST /admin/credentials') {
      const body = await readBody(request);
      const created = await store.addCredential({
        provider: text(body.provider, 'provider'),
        label: typeof body.label === 'string' ? body.label : '',
        secret: text(body.secret, 'secret'),
      });
      await app.providers.reload();
      logger.info('admin.credential_added', { provider: created.provider, label: created.label });
      send(response, 201, { credential: created });
      return true;
    }

    if (route.startsWith('POST /admin/credentials/') && url.pathname.endsWith('/toggle')) {
      const id = url.pathname.split('/')[3] as string;
      const body = await readBody(request);
      await store.setCredentialEnabled(id, body.enabled !== false);
      await app.providers.reload();
      send(response, 200, { ok: true });
      return true;
    }

    if (route.startsWith('DELETE /admin/credentials/')) {
      const id = url.pathname.split('/')[3] as string;
      await store.removeCredential(id);
      await app.providers.reload();
      send(response, 200, { ok: true });
      return true;
    }

    if (route === 'PUT /admin/settings') {
      const body = await readBody(request);
      const next = {
        llmProvider: typeof body.llmProvider === 'string' ? body.llmProvider : undefined,
        llmModel: typeof body.llmModel === 'string' ? body.llmModel : undefined,
        embeddingProvider: typeof body.embeddingProvider === 'string' ? body.embeddingProvider : undefined,
        embeddingModel: typeof body.embeddingModel === 'string' ? body.embeddingModel : undefined,
      };

      const current = app.providers.settings();
      const embeddingChanged =
        (next.embeddingModel && next.embeddingModel !== current.embeddingModel) ||
        (next.embeddingProvider && next.embeddingProvider !== current.embeddingProvider);

      await store.saveSettings(next);

      try {
        await app.providers.reload();
      } catch (error) {
        // Put the previous selection back rather than leaving the service
        // pointing at something it cannot use.
        await store.saveSettings(current);
        await app.providers.reload();
        throw error;
      }

      send(response, 200, {
        settings: app.providers.settings(),
        // Changing the embedding model invalidates every stored vector. Saying
        // so here is the difference between a warning and a silent outage.
        reindexRequired: Boolean(embeddingChanged),
      });
      return true;
    }

    if (route === 'POST /admin/test') {
      const body = await readBody(request);
      const provider = text(body.provider, 'provider');
      const credentials = await store.listCredentials();
      const target = credentials.find((entry) => entry.provider === provider && entry.enabled);
      if (!target) throw new ValidationError(`No enabled key for "${provider}"`);

      const models = await listModels(provider, await store.secretFor(target.id));
      send(response, 200, { ok: true, models: models.length, key: `…${target.hint}` });
      return true;
    }
  } catch (raw) {
    const error = toAppError(raw);
    logger.warn('admin.request_failed', { route, err: error });
    send(response, error.status, error.toJSON());
    return true;
  }

  return false;
}
