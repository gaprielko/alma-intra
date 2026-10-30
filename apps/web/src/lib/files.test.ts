import { MAX_FILE_BYTES } from '@intra/shared/schemas';
import { canPreview, fileBadge, formatSize, previewKind, splitName, uploadRefusal } from './files';

describe('files', () => {
  it('sizes in Slovak: bytes, kB under a megabyte, MB with a decimal comma', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(48 * 1024)).toBe('48 kB');
    expect(formatSize(1.25 * 1024 * 1024)).toBe('1,3 MB');
    expect(formatSize(25 * 1024 * 1024)).toBe('25 MB');
  });

  it('badges by extension, a group only for the allowed types', () => {
    expect(fileBadge('Zmluva.pdf')).toEqual({ label: 'PDF', group: 'pdf' });
    expect(fileBadge('Tabuľka.XLSX')).toEqual({ label: 'XLSX', group: 'spreadsheet' });
    expect(fileBadge('program.exe').group).toBeNull();
  });

  it('previews only PDFs and photos', () => {
    expect(canPreview('a.pdf')).toBe(true);
    expect(canPreview('a.jpg')).toBe(true);
    expect(canPreview('a.docx')).toBe(false);
    expect(canPreview('a.svg')).toBe(false);
  });

  it('the preview dialog shows HTML, PDFs and photos, nothing else', () => {
    expect(previewKind('Ponuka.HTML')).toBe('html');
    expect(previewKind('Navod.md')).toBe('markdown');
    expect(previewKind('a.pdf')).toBe('pdf');
    expect(previewKind('a.png')).toBe('image');
    expect(previewKind('a.svg')).toBeNull();
    expect(previewKind('a.docx')).toBeNull();
    expect(previewKind('bez prípony')).toBeNull();
  });

  it('refuses before uploading: unknown or empty, or too large', () => {
    expect(uploadRefusal({ name: 'a.pdf', size: 10 })).toBeNull();
    expect(uploadRefusal({ name: 'a.exe', size: 10 })).toBe('notAllowed');
    expect(uploadRefusal({ name: 'a.pdf', size: 0 })).toBe('notAllowed');
    expect(uploadRefusal({ name: 'a.pdf', size: MAX_FILE_BYTES + 1 })).toBe('tooLarge');
  });

  it('splits a name from its extension', () => {
    expect(splitName('Cenník 2027.pdf')).toEqual({ base: 'Cenník 2027', ext: '.pdf' });
    expect(splitName('bez prípony')).toEqual({ base: 'bez prípony', ext: '' });
    expect(splitName('a.b.docx')).toEqual({ base: 'a.b', ext: '.docx' });
  });
});
