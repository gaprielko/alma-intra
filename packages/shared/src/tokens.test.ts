import { describe, expect, it } from 'vitest';
import { tokens } from './tokens.js';

/** WCAG 2.x relative luminance of a `#RRGGBB` colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio of two `#RRGGBB` colours, 1 to 21. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe('the dark teal of the login and the Profil header (ALMA-293)', () => {
  it('is `ink`, Figma `bg/dark` (VariableID:1:8), which frames M01 and M25 bind', () => {
    expect(tokens.colors.ink).toBe('#0C3B3C');
  });

  it('carries every text on it at 4.5:1 or more (WCAG AA for body text)', () => {
    // Pinned, so that a retint is a decision, not an accident.
    const pairs = [
      ['onDarkMuted', 6.95],
      ['onDarkSoft', 10.45],
      ['onDarkMeta', 7.77],
    ] as const;
    for (const [name, pinned] of pairs) {
      const ratio = contrast(tokens.colors[name], tokens.colors.ink);
      expect(ratio, name).toBeGreaterThanOrEqual(4.5);
      expect(ratio, name).toBeCloseTo(pinned, 1);
    }
  });

  it('carries the name and the „Upraviť“ label in white far above it', () => {
    expect(contrast(tokens.colors.primaryForeground, tokens.colors.ink)).toBeGreaterThan(12);
  });

  it('computes the known extremes', () => {
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBe(1);
  });
});

describe('the web neutrals for a projector (ALMA-353)', () => {
  const web = tokens.web.colors;

  it('are darker than the phone neutrals they stand in for', () => {
    expect(luminance(web.canvas)).toBeLessThan(luminance(tokens.colors.surface));
    expect(luminance(web.border)).toBeLessThan(luminance(tokens.colors.border));
    expect(luminance(web.muted)).toBeLessThan(luminance(tokens.colors.muted));
    expect(luminance(web.tertiary)).toBeLessThan(luminance(tokens.colors.tertiary));
  });

  it('carry the muted text at 4.5:1 or more on a card and on the canvas', () => {
    expect(contrast(web.muted, web.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(web.muted, web.canvas)).toBeGreaterThanOrEqual(4.5);
  });

  it('keep a skeleton bar or a badge track apart from the canvas', () => {
    expect(contrast(web.track, web.canvas)).toBeGreaterThan(1.05);
  });

  it('lift the tertiary meta text to 3:1 on a card', () => {
    expect(contrast(web.tertiary, web.surface)).toBeGreaterThanOrEqual(3);
  });
});
