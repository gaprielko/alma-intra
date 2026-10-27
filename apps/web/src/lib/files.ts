import { FILE_TYPES, type FileGroup, fileExtension, MAX_FILE_BYTES } from '@intra/shared/schemas';

/** `48 kB`, `1,2 MB`: Slovak decimals, kB under a megabyte. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toLocaleString('sk-SK', { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`;
}

/** The badge of a file: its extension in capitals, in the colours of its group. */
export function fileBadge(name: string): { label: string; group: FileGroup | null } {
  const ext = fileExtension(name);
  const match = /\.([A-Za-z0-9]+)$/.exec(name);
  return {
    label: (match?.[1] ?? '').slice(0, 4).toUpperCase(),
    group: ext ? FILE_TYPES[ext].group : null,
  };
}

/** Whether the browser shows the file itself (a PDF or a photo) instead of saving it. */
export function canPreview(name: string): boolean {
  const ext = fileExtension(name);
  return ext !== null && FILE_TYPES[ext].preview;
}

/** Why a picked file cannot be uploaded, before anything is sent; `null` when it can. */
export function uploadRefusal(file: {
  name: string;
  size: number;
}): 'tooLarge' | 'notAllowed' | null {
  if (fileExtension(file.name) === null) return 'notAllowed';
  if (file.size === 0) return 'notAllowed';
  if (file.size > MAX_FILE_BYTES) return 'tooLarge';
  return null;
}

/** The name without its extension, and the extension with its dot: `Cenník 2027` + `.pdf`. */
export function splitName(name: string): { base: string; ext: string } {
  const match = /^(.*?)(\.[A-Za-z0-9]+)?$/.exec(name);
  return { base: match?.[1] ?? name, ext: match?.[2] ?? '' };
}
