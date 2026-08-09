/**
 * Turns a follow-up into a standalone question.
 *
 * "Can you explain more about this?" carries no meaning in vector space — the
 * word "this" is not a topic, so retrieval finds nothing and the question is
 * refused despite the answer sitting in the corpus. Resolving the reference
 * against the conversation first is the single largest quality difference
 * between a chat assistant and a search box.
 */

import type { PooledLlm } from '../providers/index.ts';
import type { ConversationTurn } from '../domain/types.ts';

/** Words that only mean something relative to what was said before. */
const REFERRING =
  /\b(this|that|these|those|it|its|they|them|their|the same|above|earlier|previous|former|latter)\b/i;

const ELABORATION =
  /\b(more|further|elaborate|expand|detail|details|explain|clarify|example|examples|why|how so|such as|instead|also|and what about|what about)\b/i;

const OPENS_WITH_CONJUNCTION = /^(and|but|so|then|also|what about|how about|ok|okay)\b/i;

/**
 * Whether a question needs the conversation to make sense.
 *
 * Deliberately generous: a false positive costs one cheap model call, while a
 * false negative costs a wrong refusal on a perfectly reasonable follow-up.
 */
export function looksContextDependent(question: string): boolean {
  const text = question.trim();
  if (text.length === 0) return false;

  const words = text.split(/\s+/);

  if (OPENS_WITH_CONJUNCTION.test(text)) return true;
  // Three words or fewer is almost always a follow-up ("tell me more", "why").
  // Four would sweep in "What is SQL injection?", a complete question that
  // needs no rewriting — and anything longer that slips through is still
  // caught by the retry after a gate miss.
  if (words.length <= 3) return true;
  if (REFERRING.test(text) && words.length <= 16) return true;
  if (ELABORATION.test(text) && words.length <= 12) return true;

  return false;
}

const REWRITE_SYSTEM = `You rewrite a follow-up message into a question that stands on its own.

RULES
1. Resolve every pronoun and reference using the conversation, so the result makes sense with no prior context.
2. Keep the user's intent and specificity exactly. Do not broaden, narrow, or add detail they did not ask for.
3. Output only the rewritten question. No preamble, no explanation, no quotation marks.
4. If the message already stands alone, output it unchanged.
5. Never answer the question. You only rewrite it.`;

function renderHistory(history: ConversationTurn[]): string {
  return history
    .map((turn) => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.content}`)
    .join('\n');
}

/** Most models drift or truncate badly beyond this; also caps prompt cost. */
const MAX_REWRITE_TOKENS = 1024;
const MAX_REWRITTEN_LENGTH = 300;

export async function condenseQuestion(
  question: string,
  history: ConversationTurn[],
  llm: PooledLlm,
  /** Small model to use instead of the answering one. Empty means the default. */
  model = '',
): Promise<string> {
  if (history.length === 0) return question;

  const user = [
    'CONVERSATION SO FAR',
    renderHistory(history),
    '',
    'FOLLOW-UP MESSAGE',
    question.trim(),
  ].join('\n');

  try {
    const completion = await llm.generate({
      system: REWRITE_SYSTEM,
      user,
      maxTokens: MAX_REWRITE_TOKENS,
      temperature: 0,
      ...(model ? { model } : {}),
    });

    const rewritten = completion.text.trim().replace(/^["']|["']$/g, '');

    // A rewrite that comes back empty, enormous, or multi-paragraph means the
    // model answered instead of rewriting. The original is safer than that.
    if (rewritten.length === 0 || rewritten.length > MAX_REWRITTEN_LENGTH || rewritten.includes('\n\n')) {
      return question;
    }

    return rewritten;
  } catch {
    // Rewriting is an enhancement. If it fails, retrieval still gets a real
    // question — just the original one.
    return question;
  }
}
