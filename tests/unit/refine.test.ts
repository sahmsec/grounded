import { describe, expect, it } from 'vitest';
import { detectStyle, isRefinementOnly, lastSubstantiveQuestion, styleDirective } from '../../src/rag/refine.ts';
import { classifyIntent } from '../../src/rag/intent.ts';

describe('detectStyle', () => {
  it.each([
    ['can you explain more', 'expand'],
    ['why so short', 'expand'],
    ['give me more details', 'expand'],
    ['i asked to expand your answer for more details', 'expand'],
    ['explain sqli in two lines', 'shorten'],
    ['keep it brief', 'shorten'],
    ['explain it in plain english', 'simplify'],
    ['show me an example', 'examples'],
    ['put that in bullet points', 'bullets'],
  ] as const)('reads "%s" as %s', (text, kind) => {
    expect(detectStyle(text)).toBe(kind);
  });

  it('finds no style request in an ordinary question', () => {
    expect(detectStyle('What is SQL injection?')).toBeNull();
    expect(detectStyle('How does multi-factor authentication work?')).toBeNull();
  });
});

describe('isRefinementOnly', () => {
  it.each([
    'can you explain more',
    'why so shorty',
    'i asked to expand your answer for more details',
    'more detail',
    'elaborate',
    'go on',
    'shorter',
    'give me an example',
    'make it simpler',
  ])('treats "%s" as an instruction about the previous answer', (text) => {
    expect(isRefinementOnly(text)).toBe(true);
  });

  it.each([
    'What is SQL injection?',
    // Carries its own subject, so it must be answered directly rather than
    // re-answering whatever came before.
    'can you explain a bit about sqli in short in two lines',
    'explain phishing in more detail',
    'give me an example of a ransomware attack chain and how it starts',
  ])('leaves "%s" as a question in its own right', (text) => {
    expect(isRefinementOnly(text)).toBe(false);
  });
});

describe('styleDirective', () => {
  it('asks for depth without licensing invention', () => {
    const directive = styleDirective('expand');
    expect(directive).toMatch(/more depth/i);
    // The guarantee has to survive a request for more: no sources, no claims.
    expect(directive).toMatch(/not introduce anything the sources do not contain/i);
  });

  it('gives a concrete limit when brevity is asked for', () => {
    expect(styleDirective('shorten')).toMatch(/two sentences/i);
  });
});

describe('lastSubstantiveQuestion', () => {
  const history = [
    { role: 'user' as const, content: 'what is sql injection' },
    { role: 'assistant' as const, content: 'It lets an attacker tamper with queries.' },
    { role: 'user' as const, content: 'can you explain more' },
    { role: 'assistant' as const, content: 'It occurs when input is concatenated.' },
  ];

  it('skips past the reader’s own refinement requests', () => {
    // Otherwise "more" would resolve to "more", and the chain never reaches
    // an actual topic.
    expect(lastSubstantiveQuestion(history)).toBe('what is sql injection');
  });

  it('returns null when the conversation has no real question yet', () => {
    expect(lastSubstantiveQuestion([{ role: 'user', content: 'explain more' }])).toBeNull();
  });

  it('ignores assistant turns', () => {
    expect(
      lastSubstantiveQuestion([
        { role: 'assistant', content: 'What is phishing?' },
        { role: 'user', content: 'more' },
      ]),
    ).toBeNull();
  });
});

describe('questions about the assistant', () => {
  it.each(['are you usable now', 'are you working', 'r u there', 'is this working'])(
    'reads "%s" as a capability question rather than searching for it',
    (text) => {
      expect(classifyIntent(text)).toBe('capabilities');
    },
  );

  it('does not swallow a real question that opens the same way', () => {
    expect(classifyIntent('are you familiar with phishing attacks')).toBe('question');
  });
});
