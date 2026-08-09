/**
 * The chat page's inline script, checked without a browser.
 *
 * A stray escape once turned the inline-markup regex into a literal newline.
 * That is a syntax error in the whole `<script>` block, so the page loaded and
 * did absolutely nothing — no error visible anywhere except the console. These
 * tests parse the real file, so that cannot ship again.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

interface FakeNode {
  tagName: string;
  className: string;
  children: Array<FakeNode | { text: string }>;
  lastElementChild: FakeNode | null;
  append(...nodes: Array<FakeNode | { text: string }>): void;
  textContent: string;
  classList: { add(): void };
  style: Record<string, string>;
}

function fakeElement(tag: string): FakeNode {
  const node: FakeNode = {
    tagName: tag.toUpperCase(),
    className: '',
    children: [],
    lastElementChild: null,
    append(...nodes) {
      node.children.push(...nodes);
      for (const child of nodes) {
        if ((child as FakeNode).tagName) node.lastElementChild = child as FakeNode;
      }
    },
    set textContent(value: string) {
      node.children = [{ text: value }];
    },
    get textContent() {
      return '';
    },
    classList: { add() {} },
    style: {},
  };
  return node;
}

/** Flattens the tree to a compact string so structure is easy to assert on. */
function shape(node: FakeNode | { text: string }, out: string[] = []): string[] {
  if ('text' in node) {
    out.push(JSON.stringify(node.text));
    return out;
  }
  out.push(`<${node.tagName.toLowerCase()}${node.className ? '.' + node.className : ''}>`);
  for (const child of node.children) shape(child, out);
  return out;
}

let script = '';
let renderMarkdown: (text: string) => FakeNode;

beforeAll(async () => {
  const html = await readFile(path.join(ROOT, 'public', 'index.html'), 'utf8');
  script = html.split('<script>')[1]!.split('</script>')[0]!;

  const start = script.indexOf('const INLINE =');
  const end = script.indexOf('function shield()');

  const globals = globalThis as unknown as { document: unknown };
  globals.document = {
    createElement: fakeElement,
    createTextNode: (text: string) => ({ text }),
  };

  const factory = new Function(
    'function el(t,c,x){const n=document.createElement(t);n.className=c||"";' +
      'if(x!==undefined)n.textContent=x;return n;}\n' +
      script.slice(start, end) +
      '; return { renderMarkdown };',
  ) as () => { renderMarkdown: (text: string) => FakeNode };

  renderMarkdown = factory().renderMarkdown;
});

describe('chat page script', () => {
  it('parses as valid JavaScript', () => {
    // The regression this file exists for.
    expect(() => new Function(script)).not.toThrow();
  });

  it('never builds markup from strings', () => {
    // Replies contain model output derived from retrieved third-party text.
    expect(script).not.toMatch(/\.innerHTML\s*=/);
    expect(script).not.toMatch(/insertAdjacentHTML/);
  });
});

describe('renderMarkdown', () => {
  it('renders a plain paragraph', () => {
    expect(shape(renderMarkdown('Just a sentence.')).join(' ')).toBe('<div> <p> "Just a sentence."');
  });

  it('renders headings, bullets, bold and citations together', () => {
    const output = shape(
      renderMarkdown('## Forms of XSS\n\n* **Stored:** saved then shown [1].\n* **Reflected:** echoed [1, 2].'),
    ).join(' ');

    expect(output).toContain('<h3>');
    expect(output).toContain('<ul>');
    expect(output).toContain('<strong>');
    expect(output).toContain('<span.cite-ref> "1,2"');
  });

  it('joins soft-wrapped lines into one paragraph', () => {
    const output = shape(renderMarkdown('One line\ncontinues here.')).join(' ');
    const paragraphs = output.match(/<p>/g) ?? [];
    expect(paragraphs).toHaveLength(1);
  });

  it('keeps fenced code verbatim, without parsing markup inside it', () => {
    const output = shape(renderMarkdown('```\nSELECT * FROM users WHERE x = **1**\n```')).join(' ');

    expect(output).toContain('<pre>');
    expect(output).toContain('<code>');
    // The asterisks must survive as text rather than becoming emphasis.
    expect(output).toContain('**1**');
    expect(output).not.toContain('<strong>');
  });

  it('renders inline code without treating it as markup', () => {
    expect(shape(renderMarkdown('Avoid `innerHTML` here.')).join(' ')).toContain('<code> "innerHTML"');
  });

  it('starts a new list when the marker style changes', () => {
    const output = shape(renderMarkdown('* one\n\n1. first')).join(' ');
    expect(output).toContain('<ul>');
    expect(output).toContain('<ol>');
  });

  it('produces text nodes, never raw HTML, for anything that looks like a tag', () => {
    const output = shape(renderMarkdown('Beware <img src=x onerror=alert(1)> in comments.')).join(' ');
    expect(output).toContain('<img src=x onerror=alert(1)>');
    // Present as text within a paragraph, not as an element.
    expect(output.startsWith('<div> <p> ')).toBe(true);
  });
});
