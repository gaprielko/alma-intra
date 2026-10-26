import { describe, expect, it } from 'vitest';
import { plural, sk } from './sk.js';

/** Every UI string with its key path; a function contributes its source, template literals included. */
function strings(node: unknown, path: string, out: [string, string][]): [string, string][] {
  if (typeof node === 'string') out.push([path, node]);
  else if (typeof node === 'function') out.push([path, node.toString()]);
  else if (node && typeof node === 'object')
    for (const [key, value] of Object.entries(node)) strings(value, `${path}.${key}`, out);
  return out;
}

const all = strings(sk, 'sk', []);

const offending = (test: (text: string) => boolean) =>
  all.filter(([, text]) => test(text)).map(([path]) => path);

describe('sk copy rules', () => {
  it('has strings to check', () => {
    expect(all.length).toBeGreaterThan(100);
  });

  it('joins no two thoughts with a dash; ranges are written without spaces', () => {
    expect(offending((text) => / [–—] /.test(text))).toEqual([]);
  });

  it('names no screen or ticket code', () => {
    expect(offending((text) => /\b(INTRA|ALMA)-\d+/.test(text))).toEqual([]);
  });

  it('carries no note about the project itself', () => {
    expect(offending((text) => /\bMVP\b|\btiket|\betap[aeyou]|Figma| UI /i.test(text))).toEqual([]);
  });
});

describe('plural', () => {
  it('follows the Slovak forms', () => {
    expect(plural(1, 'kód', 'kódy', 'kódov')).toBe('1 kód');
    expect(plural(3, 'kód', 'kódy', 'kódov')).toBe('3 kódy');
    expect(plural(7, 'kód', 'kódy', 'kódov')).toBe('7 kódov');
    expect(plural(0, 'kód', 'kódy', 'kódov')).toBe('0 kódov');
  });
});
