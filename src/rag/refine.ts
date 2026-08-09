/**
 * Requests about the *form* of an answer rather than its subject.
 *
 * "Explain more", "why so short", "in bullet points" are not knowledge
 * questions — searching a security handbook for them finds nothing useful, and
 * the model correctly reports it cannot answer. The turn is an instruction
 * about the previous reply, so the right move is to answer the earlier
 * question again with the requested shape.
 *
 * Handled in code rather than left to the model: it is deterministic, costs
 * nothing, and keeps the grounding guarantee intact — the style changes, the
 * sources do not.
 */

import type { ConversationTurn } from '../domain/types.ts';

export type StyleKind = 'expand' | 'shorten' | 'simplify' | 'examples' | 'bullets';

/** Cues that ask for a different shape, wherever they appear in a turn. */
const STYLE_CUES: Array<{ kind: StyleKind; pattern: RegExp }> = [
  { kind: 'bullets', pattern: /\b(bullet|bullets|bullet points?|as a list|in points|point form)\b/i },
  {
    kind: 'examples',
    pattern: /\b(give|show|with|include|any|some)\s+(me\s+)?(an?\s+)?examples?\b|\bfor example\b/i,
  },
  {
    kind: 'shorten',
    pattern:
      /\b(shorter|in short|brief|briefly|concise|summar(ise|ize)|in (a|one|two|three) (line|lines|sentence|sentences)|tl;?dr)\b/i,
  },
  {
    kind: 'simplify',
    pattern: /\b(simpler|simplify|plain english|plain language|easier|beginner|explain like|dumb it down)\b/i,
  },
  {
    kind: 'expand',
    pattern:
      /\b(more detail|more details|in detail|expand|elaborate|go deeper|deeper|longer|explain more|tell me more|more about|why so (short|brief|vague)|too short|go on)\b/i,
  },
];

export function detectStyle(text: string): StyleKind | null {
  for (const cue of STYLE_CUES) {
    if (cue.pattern.test(text)) return cue.kind;
  }
  return null;
}

/**
 * True when the turn is *only* an instruction about the previous answer, with
 * no subject of its own — "explain more" rather than "explain XSS in more
 * detail". Deliberately narrow: treating a real question as a refinement would
 * answer the wrong thing entirely.
 */
const REFINEMENT_ONLY = [
  /^(why (is|was) (that|it|this|your answer) so (short|brief|vague|small))\b/i,
  /^why so (short|shorty|brief|vague|small|little)\b/i,
  /^(can|could|would) you (please )?(explain|expand|elaborate|tell me)( more| further| a bit more)?\??$/i,
  /^(explain|expand|elaborate|continue|go on|more|say more|tell me more)( more| on (that|this|it))?[.!?]?$/i,
  /^(in )?(more|greater) detail[s]?\??$/i,
  /^(i|you) (asked|said|wanted|want)\b.*\b(expand|more detail|more details|longer|elaborate|explain)\b/i,
  /^(make|keep) (it|that|this) (longer|shorter|simpler|briefer|more detailed)\b/i,
  /^(shorter|simpler|briefly|in short|in bullets?|as a list|bullet points?)[.!?]?$/i,
  /^(give|show) me (an? )?examples?[.!?]?$/i,
  /^(that('s| is) )?(too )?(short|brief|vague)\b/i,
];

export function isRefinementOnly(text: string): boolean {
  const trimmed = text.trim();
  // A long turn almost always carries its own subject, whatever cues it holds.
  if (trimmed.split(/\s+/).length > 12) return false;
  return REFINEMENT_ONLY.some((pattern) => pattern.test(trimmed));
}

/**
 * Appended to the prompt as the reader's request. It shapes presentation only
 * — every rule about answering strictly from the sources still applies.
 */
export function styleDirective(kind: StyleKind): string {
  switch (kind) {
    case 'expand':
      return (
        'The reader has asked for more depth. Cover the relevant material from the sources thoroughly, ' +
        'organised with short headings or bullet points. Do not introduce anything the sources do not contain — ' +
        'if they hold no further detail, say what is there and state plainly that the material goes no further.'
      );
    case 'shorten':
      return 'The reader has asked for a brief answer. Reply in no more than two sentences.';
    case 'simplify':
      return (
        'The reader has asked for plain language. Explain it as you would to someone new to the subject, ' +
        'avoiding jargon or defining it when unavoidable.'
      );
    case 'examples':
      return 'The reader has asked for examples. Include concrete ones drawn from the sources.';
    case 'bullets':
      return 'The reader has asked for a list. Present the answer as short bullet points.';
  }
}

/**
 * The most recent question that had a subject, skipping the reader's own
 * refinement requests so a chain of "more"/"and more" keeps resolving back to
 * the real topic rather than to the previous instruction.
 */
export function lastSubstantiveQuestion(history: ConversationTurn[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index];
    if (!turn || turn.role !== 'user') continue;
    if (isRefinementOnly(turn.content)) continue;
    return turn.content;
  }
  return null;
}
