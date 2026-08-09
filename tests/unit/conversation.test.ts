import { describe, expect, it, vi } from 'vitest';
import { classifyIntent, smallTalkReply } from '../../src/rag/intent.ts';
import { condenseQuestion, looksContextDependent } from '../../src/rag/rewrite.ts';
import type { PooledLlm } from '../../src/providers/index.ts';

describe('classifyIntent', () => {
  it.each(['hi', 'Hello', 'hey there', 'Good morning', 'yo', 'assalamu alaikum'])(
    'reads "%s" as a greeting',
    (text) => {
      expect(classifyIntent(text)).toBe('greeting');
    },
  );

  it.each(['thanks', 'Thank you!', 'thx', 'cheers'])('reads "%s" as thanks', (text) => {
    expect(classifyIntent(text)).toBe('thanks');
  });

  it.each(['bye', 'goodbye', 'see you'])('reads "%s" as a farewell', (text) => {
    expect(classifyIntent(text)).toBe('farewell');
  });

  it.each(['what can you do', 'what topics do you cover', 'help', 'who are you'])(
    'reads "%s" as a capability question',
    (text) => {
      expect(classifyIntent(text)).toBe('capabilities');
    },
  );

  it.each([
    'What is SQL injection?',
    'How do I prevent phishing attacks in my organisation?',
    'hello world injection attacks — how do they work in practice?',
    'Explain the difference between blind and union-based injection',
  ])('treats "%s" as a real question', (text) => {
    expect(classifyIntent(text)).toBe('question');
  });

  it('does not mistake a long message that happens to start with a greeting', () => {
    // The length guard is what stops "hi" matching inside a real question.
    expect(classifyIntent('Hi, can you explain how ransomware encrypts files on a network share?')).toBe(
      'question',
    );
  });

  it('does not mistake a question about thanking someone', () => {
    expect(classifyIntent('Should I thank the attacker for reporting the vulnerability to us?')).toBe(
      'question',
    );
  });
});

describe('smallTalkReply', () => {
  it('greets and names what it covers', () => {
    const reply = smallTalkReply('greeting', ['SQL Injection', 'Phishing']);
    expect(reply).toContain('SQL Injection');
    expect(reply).toContain('Phishing');
  });

  it('summarises a long topic list rather than reciting it', () => {
    const many = Array.from({ length: 12 }, (_, index) => `Topic ${index + 1}`);
    expect(smallTalkReply('capabilities', many)).toContain('6 more');
  });

  it('copes with an empty corpus', () => {
    expect(smallTalkReply('greeting', [])).toContain('course material');
  });

  it('returns nothing for a real question, so it falls through to retrieval', () => {
    expect(smallTalkReply('question', ['SQL Injection'])).toBeNull();
  });
});

describe('looksContextDependent', () => {
  it.each([
    'can you explain a bit more details about this',
    'tell me more',
    'why?',
    'and what about prevention',
    'give me an example',
    'elaborate on that',
    'how so',
  ])('flags "%s" as needing context', (text) => {
    expect(looksContextDependent(text)).toBe(true);
  });

  it.each([
    'What is SQL injection?',
    'How does multi-factor authentication protect an account?',
    'Describe the steps of an incident response process from detection to recovery',
  ])('leaves "%s" alone', (text) => {
    expect(looksContextDependent(text)).toBe(false);
  });
});

describe('condenseQuestion', () => {
  const history = [
    { role: 'user' as const, content: 'What is SQL injection?' },
    { role: 'assistant' as const, content: 'SQL injection lets an attacker tamper with database queries.' },
  ];

  function fakeLlm(text: string) {
    return {
      generate: vi.fn(async () => ({
        text,
        inputTokens: 10,
        outputTokens: 5,
        provider: 'stub',
        credentialId: 'stub#1',
        model: 'stub-v1',
      })),
    } as unknown as PooledLlm;
  }

  it('resolves a reference into a standalone question', async () => {
    const llm = fakeLlm('Can you explain SQL injection in more detail?');
    const result = await condenseQuestion('can you explain more about this', history, llm);

    expect(result).toBe('Can you explain SQL injection in more detail?');
  });

  it('skips the call entirely when there is no conversation', async () => {
    const llm = fakeLlm('unused');
    const result = await condenseQuestion('What is phishing?', [], llm);

    expect(result).toBe('What is phishing?');
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it('strips wrapping quotes the model sometimes adds', async () => {
    const llm = fakeLlm('"What is SQL injection?"');
    expect(await condenseQuestion('what is it', history, llm)).toBe('What is SQL injection?');
  });

  it('keeps the original when the model answers instead of rewriting', async () => {
    // A multi-paragraph reply means it explained rather than condensed.
    const llm = fakeLlm('SQL injection is a vulnerability.\n\nIt happens when input is concatenated.');
    expect(await condenseQuestion('more detail', history, llm)).toBe('more detail');
  });

  it('keeps the original when the rewrite comes back empty', async () => {
    expect(await condenseQuestion('more detail', history, fakeLlm('   '))).toBe('more detail');
  });

  it('keeps the original when the provider fails, rather than breaking the turn', async () => {
    const llm = {
      generate: vi.fn(async () => {
        throw new Error('rate limited');
      }),
    } as unknown as PooledLlm;

    expect(await condenseQuestion('more detail', history, llm)).toBe('more detail');
  });

  it('passes the conversation to the model so references can be resolved', async () => {
    const llm = fakeLlm('Can you explain SQL injection in more detail?');
    await condenseQuestion('more about this', history, llm);

    const prompt = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0].user as string;
    expect(prompt).toContain('What is SQL injection?');
    expect(prompt).toContain('more about this');
  });
});
