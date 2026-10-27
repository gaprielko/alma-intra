/**
 * The colour a name keeps: one of four soft pairs, chosen by a hash of the
 * name, so the same nurse has the same colour on every screen and on the planning grid's bars.
 */
export interface AvatarColor {
  bg: string;
  text: string;
}

export const AVATAR_COLORS: readonly AvatarColor[] = [
  { bg: '#E3F3F2', text: '#0A6466' },
  { bg: '#E9EEF6', text: '#334E7B' },
  { bg: '#FCF0DE', text: '#8A4408' },
  { bg: '#EAF5E6', text: '#2F6E25' },
];

/** A small, stable hash of a string; the same name always lands on the same pair. */
export function nameHash(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash;
}

export function avatarColorOf(name: string): AvatarColor {
  return AVATAR_COLORS[nameHash(name.trim().toLowerCase()) % AVATAR_COLORS.length]!;
}
