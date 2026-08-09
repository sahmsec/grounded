/**
 * Lists the models your key can actually use.
 *
 * A model name in .env is just a string — nothing checks it until a request is
 * made, which is how a retired model reaches production and fails at question
 * time instead of at startup. Run this before changing GEMINI_LLM_MODEL.
 *
 * Note that a model appearing here is necessary but not sufficient: Google
 * still lists models that are closed to new accounts, so this also sends one
 * tiny generation per candidate to prove it responds.
 */

import { loadConfig, loadEnvFile } from '../src/config/index.ts';
import { createGeminiLlm } from '../src/providers/llm/gemini.ts';

loadEnvFile();
const config = loadConfig();

const credential = config.llm.pool.find((entry) => entry.provider === 'gemini');
if (!credential) {
  process.stderr.write('No Gemini credential configured. Set GEMINI_API_KEYS in .env.\n');
  process.exit(1);
}

const probe = process.argv.includes('--probe');

const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${credential.apiKey}`,
);
if (!response.ok) {
  process.stderr.write(`Could not list models: ${response.status} ${await response.text()}\n`);
  process.exit(1);
}

const payload = (await response.json()) as {
  models?: Array<{ name: string; supportedGenerationMethods?: string[]; description?: string }>;
};

const all = payload.models ?? [];
const chat = all
  .filter((model) => (model.supportedGenerationMethods ?? []).includes('generateContent'))
  .map((model) => model.name.replace(/^models\//, ''))
  // Image, speech and robotics variants cannot answer questions.
  .filter((name) => !/(tts|image|robotics|lyria|nano-banana|computer-use|omni)/i.test(name));

const embedding = all
  .filter((model) => (model.supportedGenerationMethods ?? []).includes('embedContent'))
  .map((model) => model.name.replace(/^models\//, ''));

process.stdout.write(`\nCurrently configured\n  generation  ${config.llm.models.gemini}\n`);
process.stdout.write(`  embeddings  ${config.embedding.model}\n`);

process.stdout.write(`\nGeneration models offered to this key (${chat.length})\n`);
for (const name of chat) {
  process.stdout.write(`  ${name === config.llm.models.gemini ? '*' : ' '} ${name}\n`);
}

process.stdout.write(`\nEmbedding models offered to this key (${embedding.length})\n`);
for (const name of embedding) {
  process.stdout.write(`  ${name === config.embedding.model ? '*' : ' '} ${name}\n`);
}

if (!probe) {
  process.stdout.write('\nRe-run with --probe to test each generation model with a real call.\n');
  process.stdout.write('Listing is not proof: retired models stay listed but reject new accounts.\n');
} else {
  process.stdout.write('\nProbing each generation model with one small call…\n');
  for (const name of chat) {
    try {
      const provider = createGeminiLlm(credential.apiKey, name);
      const reply = await provider.generate({
        system: 'Reply with exactly one word.',
        user: 'Say OK.',
        maxTokens: config.llm.maxOutputTokens,
        temperature: 0,
      });
      process.stdout.write(`  works   ${name.padEnd(30)} "${reply.text.trim().slice(0, 20)}"\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason = /no longer available to new users/i.test(message)
        ? 'closed to new accounts'
        : /429|quota/i.test(message)
          ? 'rate limited — try again shortly'
          : message.slice(0, 70);
      process.stdout.write(`  no      ${name.padEnd(30)} ${reason}\n`);
    }
  }
}
