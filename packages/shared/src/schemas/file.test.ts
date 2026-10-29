import { describe, expect, it } from 'vitest';
import {
  isoDateSchema,
  MAX_FILE_BYTES,
  MAX_VIDEO_BYTES,
  maxBytesOf,
  splitDocumentDate,
} from './file.js';

describe('splitDocumentDate', () => {
  it('takes the date off the end of the name', () => {
    expect(splitDocumentDate('CharitaKE - Zmluva o pilotnej spolupraci 2026-10-28.pdf')).toEqual({
      name: 'CharitaKE - Zmluva o pilotnej spolupraci.pdf',
      documentDate: '2026-10-28',
    });
  });

  it('keeps a name without a date, or with one that is not a day', () => {
    expect(splitDocumentDate('Alma ADOS - Letak A4.pdf')).toEqual({
      name: 'Alma ADOS - Letak A4.pdf',
      documentDate: null,
    });
    expect(splitDocumentDate('Alma - Plan 2026-02-30.pdf').documentDate).toBeNull();
    expect(splitDocumentDate('2026-10-28.pdf').documentDate).toBeNull();
    expect(splitDocumentDate('Cennik 2026-10-28 final.pdf').documentDate).toBeNull();
  });
});

describe('isoDateSchema', () => {
  it('accepts only real calendar days', () => {
    expect(isoDateSchema.safeParse('2026-10-29').success).toBe(true);
    expect(isoDateSchema.safeParse('2026-13-01').success).toBe(false);
    expect(isoDateSchema.safeParse('29. 10. 2026').success).toBe(false);
  });
});

describe('maxBytesOf', () => {
  it('lets a video be larger than a document', () => {
    expect(maxBytesOf('Nahravka.mp4')).toBe(MAX_VIDEO_BYTES);
    expect(maxBytesOf('Nahravka.MOV')).toBe(MAX_VIDEO_BYTES);
    expect(maxBytesOf('Brozura.pdf')).toBe(MAX_FILE_BYTES);
  });
});
