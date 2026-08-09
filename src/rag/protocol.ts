/**
 * The contract between the prompt builder, the model, and the answer service.
 *
 * These constants are shared rather than duplicated because a drifting
 * sentinel is a silent failure: the model would report insufficient context
 * and the service would forward that report to the user as if it were an
 * answer.
 */

/** Emitted by the model when the supplied context cannot support an answer. */
export const INSUFFICIENT_CONTEXT_SENTINEL = 'INSUFFICIENT_CONTEXT';

/** Marks the start of the user's question inside the composed prompt. */
export const QUESTION_MARKER = '### QUESTION';

export const CONTEXT_MARKER = '### KNOWLEDGE BASE EXCERPTS';

/** Matches one `<source id="n" ...>body</source>` block. */
export const SOURCE_BLOCK_PATTERN = /<source id="(\d+)"[^>]*>([\s\S]*?)<\/source>/g;

/**
 * The single refusal string. Every refusal path returns exactly this, so the
 * behaviour is testable by equality rather than by fuzzy matching, and users
 * get one consistent message instead of a model's improvisation on the theme.
 */
export const CANONICAL_REFUSAL =
  "I don't have information about that in my knowledge base, so I can't answer it. " +
  'I can only answer questions covered by the cybersecurity documentation I have been given.';

/** True when the model signalled it could not ground an answer. */
export function isInsufficientContext(text: string): boolean {
  return text.trim().toUpperCase().includes(INSUFFICIENT_CONTEXT_SENTINEL);
}
