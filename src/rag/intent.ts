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

/**
 * Questions about the assistant rather than the subject — "are you working?",
 * "are you usable now?". Capped at four words by the caller, because "are you
 * familiar with phishing" is a real question that opens the same way.
 */
const ABOUT_THE_ASSISTANT = /^(are|r|is)\s+(you|u|this)\b/;

/**
 * Greetings and thanks in Bangla. Latin-script transliterations are covered by
 * the patterns above; these are the native-script forms, matched before
 * normalisation strips them.
 */
const BANGLA_GREETING = /(হাই|হ্যালো|হেলো|সালাম|আসসালাম|শুভ\s*(সকাল|দুপুর|বিকাল|সন্ধ্যা)|কেমন\s*আছ)/;
const BANGLA_THANKS = /(ধন্যবাদ|থ্যাংক|শুকরিয়া)/;
const BANGLA_FAREWELL = /(বিদায়|আল্লাহ\s*হাফেজ|খোদা\s*হাফেজ)/;

/** True when the text is written mainly in Bengali script. */
export function isBengaliScript(text: string): boolean {
  const bengali = text.match(/[ঀ-৿]/g)?.length ?? 0;
  const letters = text.match(/[\p{L}]/gu)?.length ?? 0;
  return letters > 0 && bengali / letters > 0.4;
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyIntent(raw: string): Intent {
  // Bengali script survives none of the Latin patterns, so it is checked
  // against the raw text before normalisation.
  if (raw.length <= 60) {
    if (BANGLA_THANKS.test(raw)) return 'thanks';
    if (BANGLA_FAREWELL.test(raw)) return 'farewell';
    if (BANGLA_GREETING.test(raw)) return 'greeting';
  }

  const text = normalise(raw);
  if (text.length === 0) return 'question';

  const words = text.split(' ').length;

  // Capability questions can be longer, and are checked first so that
  // "what topics do you cover" is not mistaken for an ordinary question.
  if (words <= 12 && CAPABILITIES.test(text)) return 'capabilities';
  if (words <= 4 && ABOUT_THE_ASSISTANT.test(text)) return 'capabilities';

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
export function smallTalkReply(intent: Intent, topics: string[], bangla = false): string | null {
  if (bangla) return banglaSmallTalk(intent, topics);

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

function banglaSmallTalk(intent: Intent, topics: string[]): string | null {
  const list = joinTopics(topics);
  switch (intent) {
    case 'greeting':
      return `আসসালামু আলাইকুম। আমি কোর্স ম্যাটেরিয়াল থেকে প্রশ্নের উত্তর দিতে পারি — ${list}। কী জানতে চান?`;
    case 'thanks':
      return 'আপনাকে স্বাগতম। কোর্স ম্যাটেরিয়াল সম্পর্কিত আরও কিছু জানতে চাইলে জিজ্ঞাসা করুন।';
    case 'farewell':
      return 'বিদায়। কোর্স ম্যাটেরিয়াল নিয়ে কিছু জানার হলে আবার আসবেন।';
    case 'capabilities':
      return (
        'আমি শুধু কোর্স ম্যাটেরিয়াল ব্যবহার করে উত্তর দিই, এবং প্রতিটি উত্তরের সূত্র দেখাই। ' +
        `যে বিষয়গুলো অন্তর্ভুক্ত: ${list}। এর বাইরের কিছু হলে অনুমান না করে সরাসরি জানিয়ে দেব।`
      );
    default:
      return null;
  }
}
