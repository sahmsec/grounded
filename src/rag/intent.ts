/**
 * Lightweight intent detection for conversational turns.
 *
 * Greetings and thanks are handled here, in code, without touching a model or
 * the knowledge base. Two reasons: it costs nothing and never fails, and it
 * keeps the grounding guarantee intact — a fixed "hello" makes no factual
 * claim, so there is nothing to ground. Sending "hi" through retrieval and
 * refusing it is technically correct and socially wrong.
 *
 * Pure and deterministic, so every rule is testable without I/O.
 */

export type Intent = 'greeting' | 'thanks' | 'farewell' | 'capabilities' | 'question';

/** Longer inputs are treated as real questions even if they open with "hi". */
const MAX_SMALL_TALK_WORDS = 6;

const GREETING = /^(hi|hey|hello|yo|hiya|howdy|greetings|salam|assalamu?\s*alaikum|good\s*(morning|afternoon|evening|day))\b/;
const THANKS = /\b(thanks|thank\s*you|thx|ty|cheers|appreciate\s*it)\b/;
const FAREWELL = /^(bye|goodbye|see\s*(you|ya)|later|good\s*night)\b/;
const CAPABILITIES =
  /^(what|which|who|how)\b.*\b(can you (do|help)|do you (do|know|cover)|are you|topics?|subjects?|modules?|help me with)\b|^help$|^what can you do\b/;

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyIntent(raw: string): Intent {
  const text = normalise(raw);
  if (text.length === 0) return 'question';

  const words = text.split(' ').length;

  // Capability questions can be longer, and are checked first so that
  // "what topics do you cover" is not mistaken for an ordinary question.
  if (words <= 12 && CAPABILITIES.test(text)) return 'capabilities';

  if (words > MAX_SMALL_TALK_WORDS) return 'question';

  if (GREETING.test(text)) return 'greeting';
  if (FAREWELL.test(text)) return 'farewell';
  if (THANKS.test(text)) return 'thanks';

  return 'question';
}

function joinTopics(topics: string[]): string {
  if (topics.length === 0) return 'the course material';
  if (topics.length <= 6) {
    return `${topics.slice(0, -1).join(', ')} and ${topics[topics.length - 1]}`;
  }
  return `${topics.slice(0, 6).join(', ')}, and ${topics.length - 6} more`;
}

/** The reply for a non-question turn, or null when the turn is a question. */
export function smallTalkReply(intent: Intent, topics: string[]): string | null {
  switch (intent) {
    case 'greeting':
      return (
        'Hello. I can answer questions about the course material — ' +
        `${joinTopics(topics)}. What would you like to know?`
      );
    case 'thanks':
      return 'You are welcome. Ask me anything else from the course material.';
    case 'farewell':
      return 'Goodbye. Come back whenever you need something from the course material.';
    case 'capabilities':
      return (
        'I answer questions using the course material only, and I show you the passage each answer ' +
        `came from. The topics covered are ${joinTopics(topics)}. ` +
        'If something falls outside them I will say so rather than guess.'
      );
    default:
      return null;
  }
}
