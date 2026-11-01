import { describe, expect, it, vi } from 'vitest';
import { fileDocument, followFragmentLinks, markdownDocument, safeDocument } from './safe-html';

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

describe('links within a document in the frame', () => {
  const setUp = (href: string) => {
    let click: (event: unknown) => void = () => undefined;
    const details = { localName: 'details', parentElement: null, setAttribute: vi.fn() };
    const section = { localName: 'section', parentElement: details };
    const target = { parentElement: section, scrollIntoView: vi.fn() };
    const frame = {
      addEventListener: (_type: string, listener: (event: unknown) => void) => (click = listener),
      getElementById: (id: string) => (id === 'kapitola' ? target : null),
    };
    followFragmentLinks(frame as unknown as Document);
    const event = {
      preventDefault: vi.fn(),
      target: { closest: () => (href ? { getAttribute: () => href } : null) },
    };
    click(event);
    return { details, target, event };
  };

  it('stays in the frame, opens what is collapsed around the target and scrolls to it', () => {
    const { details, target, event } = setUp('#kapitola');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(details.setAttribute).toHaveBeenCalledWith('open', '');
    expect(target.scrollIntoView).toHaveBeenCalled();
  });

  it('does nothing for a link to a missing place', () => {
    const { target } = setUp('#nikde');
    expect(target.scrollIntoView).not.toHaveBeenCalled();
  });

  it('leaves other links and clicks alone', () => {
    const { event } = setUp('');
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
