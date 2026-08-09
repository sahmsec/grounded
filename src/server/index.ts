/**
 * HTTP surface.
 *
 * Three routes on `node:http`. A web framework would be a dependency and a
 * layer of indirection for a router with three entries.
 */

import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createApp, type App } from '../app.ts';
import { toAppError } from '../errors/index.ts';
import type { Logger } from '../logging/logger.ts';
import { handleAdmin } from './admin-routes.ts';

const MAX_BODY_BYTES = 64 * 1024;
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

function send(response: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(chunk as Buffer);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Request body is not valid JSON');
  }
}

export function createServer(app: App): http.Server {
  return http.createServer((request, response) => {
    const requestId = randomUUID();
    const logger: Logger = app.logger.child({ requestId });
    const startedAt = Date.now();

    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const route = `${request.method} ${url.pathname}`;

      try {
        if (route === 'GET /' || route === 'GET /index.html') {
          const html = await readFile(path.join(PUBLIC_DIR, 'index.html'));
          response.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'content-length': html.byteLength,
          });
          response.end(html);
          return;
        }

        if (route === 'GET /health') {
          const healthy = await app.healthy();
          const pools = app.poolStatus();
          const ready = healthy && pools.llm.state !== 'exhausted' && pools.embedding.state !== 'exhausted';

          send(response, ready ? 200 : 503, {
            status: ready ? 'ok' : 'degraded',
            database: healthy ? 'up' : 'down',
            pools: { llm: pools.llm.state, embedding: pools.embedding.state },
            // The UI draws its score scale against the live gate rather than a
            // hardcoded copy, so the two can never drift apart.
            gate: app.config.gate,
            embeddingModel: app.config.embedding.model,
          });
          return;
        }

        if (route === 'GET /modules') {
          send(response, 200, { modules: await app.documents.listTopics() });
          return;
        }

        if (route === 'GET /admin' || route === 'GET /admin/') {
          const html = await readFile(path.join(PUBLIC_DIR, 'admin.html'));
          response.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'content-length': html.byteLength,
          });
          response.end(html);
          return;
        }

        if (url.pathname.startsWith('/admin/')) {
          if (await handleAdmin(app, request, response, route, url, logger)) return;
        }

        if (route === 'POST /ask') {
          const body = (await readJsonBody(request)) as { question?: unknown };
          const question = typeof body.question === 'string' ? body.question : '';

          const result = await app.answers.ask(question);
          send(response, 200, result);
          return;
        }

        send(response, 404, { error: 'not_found', message: `No route for ${route}` });
      } catch (raw) {
        const error = toAppError(raw);
        logger.error('request.failed', { route, err: error });
        send(response, error.status, error.toJSON());
      } finally {
        logger.info('request.complete', {
          method: request.method,
          path: url.pathname,
          status: response.statusCode,
          durationMs: Date.now() - startedAt,
        });
      }
    })();
  });
}

async function main(): Promise<void> {
  const app = await createApp();
  const server = createServer(app);

  server.listen(app.config.port, () => {
    app.logger.info('server.listening', { port: app.config.port });
  });

  const shutdown = (signal: string): void => {
    app.logger.info('server.shutdown', { signal });
    server.close(() => {
      void app.close().then(() => process.exit(0));
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Only start a listener when this file is the entrypoint, so tests can import
// createServer without binding a port. Path comparison rather than URL
// comparison, because Windows drive-letter casing makes the URLs differ.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
