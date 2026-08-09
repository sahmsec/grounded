/**
 * Live provider smoke test.
 *
 * Makes the two smallest possible real calls — one embedding, one generation —
 * to confirm credentials work before spending a full re-index on them.
 * Prints no secrets.
 */

import { loadConfig, loadEnvFile } from '../src/config/index.ts';
import { createGeminiEmbeddings } from '../src/providers/embeddings/gemini.ts';
import { createGeminiLlm } from '../src/providers/llm/gemini.ts';
import { isAppError, ProviderError } from '../src/errors/index.ts';

loadEnvFile();
const config = loadConfig();

function mask(key: string): string {
  return key.length <= 8 ? '***' : `${key.slice(0, 4)}…${key.slice(-4)}`;
}

let failures = 0;

for (const credential of config.embedding.pool) {
  const label = `${credential.id} (${mask(credential.apiKey)})`;
  try {
    const provider = createGeminiEmbeddings(
      credential.apiKey,
      config.embedding.model,
      config.embedding.dimensions,
    );
    const vector = await provider.embedQuery('test');
    process.stdout.write(`  ok    embeddings  ${label} — ${vector.length} dimensions\n`);
  } catch (error) {
    failures += 1;
    const kind = error instanceof ProviderError ? error.kind : 'unknown';
    const message = isAppError(error) ? error.message : String(error);
    process.stdout.write(`  FAIL  embeddings  ${label}\n          [${kind}] ${message.slice(0, 300)}\n`);
  }
}

for (const credential of config.llm.pool) {
  const label = `${credential.id} (${mask(credential.apiKey)})`;
  try {
    const provider = createGeminiLlm(credential.apiKey, config.llm.models[credential.provider] as string);
    const reply = await provider.generate({
      system: 'Reply with exactly one word.',
      user: 'Say OK.',
      // The configured budget, not a token or two: thinking is charged against
      // maxOutputTokens, so a tiny cap fails here while production succeeds —
      // a smoke test that does not match production tests the wrong thing.
      maxTokens: config.llm.maxOutputTokens,
      temperature: 0,
    });
    process.stdout.write(`  ok    generation  ${label} — "${reply.text.trim().slice(0, 40)}"\n`);
  } catch (error) {
    failures += 1;
    const kind = error instanceof ProviderError ? error.kind : 'unknown';
    const message = isAppError(error) ? error.message : String(error);
    process.stdout.write(`  FAIL  generation  ${label}\n          [${kind}] ${message.slice(0, 300)}\n`);
  }
}

process.stdout.write(failures === 0 ? '\nAll credentials working.\n' : `\n${failures} check(s) failed.\n`);
process.exitCode = failures === 0 ? 0 : 1;
