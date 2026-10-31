import { describe, expect, it } from 'vitest';
import { fileDocument, markdownDocument, safeDocument } from './safe-html';

const policy = (html: string) => /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];

describe('documents for a frame without scripts', () => {
  it('lets an e-mail load nothing from the internet', () => {
    expect(policy(safeDocument('<img src="https://x.test/a.png">'))).toContain('img-src data:;');
  });

  it('lets a file show its pictures, but no remote style, font or script', () => {
    for (const make of [fileDocument, markdownDocument]) {
      const rules = policy(make('<p>a</p>'));
      expect(rules).toContain('img-src data: https:;');
      expect(rules).toContain("default-src 'none'");
      expect(rules).toContain("style-src 'unsafe-inline'");
      expect(rules).not.toContain('script-src');
    }
  });

  it('tells a picture host nothing about where the file was opened', () => {
    expect(fileDocument('')).toContain('name="referrer" content="no-referrer"');
  });
});
