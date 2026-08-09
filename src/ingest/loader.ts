/**
 * Reads seed documents from markdown files with a small frontmatter header.
 *
 * The parser handles exactly the subset used by the seed corpus — flat
 * `key: value` pairs — rather than pulling in a YAML dependency for four
 * fields.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DocumentInput } from '../domain/types.ts';
import { ValidationError } from '../errors/index.ts';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseDocument(raw: string, filename: string): DocumentInput {
  const match = FRONTMATTER.exec(raw);
  if (!match) {
    throw new ValidationError(`${filename} is missing a frontmatter block`, { filename });
  }

  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf(':');
    if (separator === -1) {
      throw new ValidationError(`${filename} has a malformed frontmatter line: "${trimmed}"`, { filename });
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    fields[key] = value;
  }

  const content = raw.slice(match[0].length).trim();
  const slug = fields.slug ?? path.basename(filename, '.md');

  for (const required of ['title', 'source'] as const) {
    if (!fields[required]) {
      throw new ValidationError(`${filename} is missing required frontmatter field "${required}"`, {
        filename,
        field: required,
      });
    }
  }

  if (content.length === 0) {
    throw new ValidationError(`${filename} has frontmatter but no body`, { filename });
  }

  return {
    slug,
    title: fields.title!,
    source: fields.source!,
    category: fields.category ?? 'general',
    content,
    metadata: fields.tags ? { tags: fields.tags.split(',').map((tag) => tag.trim()) } : {},
  };
}

export async function loadSeedDocuments(directory: string): Promise<DocumentInput[]> {
  const entries = await readdir(directory);
  const files = entries.filter((name) => name.endsWith('.md')).sort();

  const documents: DocumentInput[] = [];
  for (const file of files) {
    const raw = await readFile(path.join(directory, file), 'utf8');
    documents.push(parseDocument(raw, file));
  }

  return documents;
}
