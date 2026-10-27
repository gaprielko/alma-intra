import { MAX_FILE_BYTES } from '@intra/shared/schemas';
import { refusal } from './attachments.js';

describe('refusal', () => {
  it('takes the types and the size Files takes', () => {
    expect(refusal({ filename: 'zmluva.pdf', size: 1200 })).toBeNull();
    expect(refusal({ filename: 'Foto.JPG', size: 1200 })).toBeNull();
  });

  it('leaves out another type and anything too big', () => {
    expect(refusal({ filename: 'program.exe', size: 10 })).toBe('type');
    expect(refusal({ filename: 'bez-pripony', size: 10 })).toBe('type');
    expect(refusal({ filename: 'velke.pdf', size: MAX_FILE_BYTES + 1 })).toBe('size');
  });
});
