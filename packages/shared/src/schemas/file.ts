import { z } from 'zod';
import { idSchema } from './common.js';

/** Signed URLs are short-lived: long enough for one upload or one download, no more. */
export const FILE_URL_TTL_SECONDS = { upload: 600, download: 300 } as const;

/** At most 50 MB per file; a video up to `MAX_VIDEO_BYTES`. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

/** How long a file stays in „Kôš“ before it is deleted for good. */
export const TRASH_DAYS = 30;

/** „Firemné dokumenty“: the root of the company's folder tree, installed by a migration. */
export const COMPANY_ROOT_FOLDER_ID = '00000000-0000-4000-8000-0000000000f0';

/** What the list's type filter and the coloured badge group files by. */
export const FILE_GROUPS = [
  'pdf',
  'document',
  'spreadsheet',
  'presentation',
  'image',
  'video',
  'text',
  'archive',
] as const;
export type FileGroup = (typeof FILE_GROUPS)[number];

/**
 * The allowed types, by extension. The content type stored and served is the one named here, never
 * the one a browser declared: browsers disagree about CSV and Markdown. `preview`: shown in the
 * browser; everything else, an SVG included (it can carry a script), is only downloaded.
 */
export const FILE_TYPES = {
  pdf: { mime: 'application/pdf', group: 'pdf', preview: true },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    group: 'document',
    preview: false,
  },
  odt: { mime: 'application/vnd.oasis.opendocument.text', group: 'document', preview: false },
  doc: { mime: 'application/msword', group: 'document', preview: false },
  rtf: { mime: 'application/rtf', group: 'document', preview: false },
  /** A document written as HTML (and printed to PDF): saved, never shown, it can carry a script. */
  html: { mime: 'text/html', group: 'document', preview: false },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    group: 'spreadsheet',
    preview: false,
  },
  csv: { mime: 'text/csv', group: 'spreadsheet', preview: false },
  pptx: {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    group: 'presentation',
    preview: false,
  },
  txt: { mime: 'text/plain', group: 'text', preview: false },
  md: { mime: 'text/markdown', group: 'text', preview: false },
  jpg: { mime: 'image/jpeg', group: 'image', preview: true },
  jpeg: { mime: 'image/jpeg', group: 'image', preview: true },
  png: { mime: 'image/png', group: 'image', preview: true },
  webp: { mime: 'image/webp', group: 'image', preview: true },
  svg: { mime: 'image/svg+xml', group: 'image', preview: false },
  mp4: { mime: 'video/mp4', group: 'video', preview: false },
  mov: { mime: 'video/quicktime', group: 'video', preview: false },
  zip: { mime: 'application/zip', group: 'archive', preview: false },
} as const satisfies Record<string, { mime: string; group: FileGroup; preview: boolean }>;
export type FileExtension = keyof typeof FILE_TYPES;

/** The extension of a name, lower case, or `null` when it is not one of the allowed. */
export function fileExtension(name: string): FileExtension | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(name);
  const ext = match?.[1]?.toLowerCase();
  return ext !== undefined && Object.hasOwn(FILE_TYPES, ext) ? (ext as FileExtension) : null;
}

/** The largest upload a name's type allows. */
export function maxBytesOf(name: string): number {
  const ext = fileExtension(name);
  return ext !== null && FILE_TYPES[ext].group === 'video' ? MAX_VIDEO_BYTES : MAX_FILE_BYTES;
}

/** A calendar day, `2026-10-29`. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date')
  .refine(isCalendarDay, 'invalid_date');

function isCalendarDay(value: string) {
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

/**
 * The document's date out of its name: `Alma ADOS - Cennik 2027-01-15.pdf` is the file
 * `Alma ADOS - Cennik.pdf` dated 15 January 2027. A name without a valid date at its end is kept
 * as it is, with no date.
 */
export function splitDocumentDate(name: string): { name: string; documentDate: string | null } {
  const match = /^(.*\S)\s+(\d{4}-\d{2}-\d{2})(\.[A-Za-z0-9]+)$/.exec(name);
  if (!match || !isCalendarDay(match[2]!)) return { name, documentDate: null };
  return { name: `${match[1]}${match[3]}`, documentDate: match[2]! };
}

/** What the `accept` attribute of a file input lists. */
export const FILE_ACCEPT = Object.keys(FILE_TYPES)
  .map((ext) => `.${ext}`)
  .join(',');

/** A name as a person types it: no path separators or control characters. */
const nameSchema = z
  .string()
  .trim()
  .min(1, 'required')
  .max(200, 'too_long')
  .refine(
    (value) =>
      !/[/\\]/.test(value) && ![...value].some((c) => c.charCodeAt(0) < 0x20 || c === '\u007f'),
    'invalid_name',
  );

export const folderNameSchema = nameSchema;
/** A file's name keeps an allowed extension. */
export const fileNameSchema = nameSchema.refine(
  (value) => fileExtension(value) !== null,
  'file_type_not_allowed',
);

export const createFolderSchema = z.object({ parentId: idSchema, name: folderNameSchema });
export const renameFolderSchema = z.object({ id: idSchema, name: folderNameSchema });
export const moveFolderSchema = z.object({ id: idSchema, parentId: idSchema });
export const folderIdSchema = z.object({ id: idSchema });

export const FILE_PERIODS = ['week', 'month', 'year'] as const;
export type FilePeriod = (typeof FILE_PERIODS)[number];

/**
 * A folder's content, or with `search` the files of every folder whose name matches. The filters
 * narrow both.
 */
export const folderContentsSchema = z.object({
  folderId: idSchema,
  search: z.string().trim().max(100).optional(),
  group: z.enum(FILE_GROUPS).optional(),
  changedBy: idSchema.optional(),
  period: z.enum(FILE_PERIODS).optional(),
  /** The document's date, from and to, both days included. */
  dateFrom: isoDateSchema.optional(),
  dateTo: isoDateSchema.optional(),
});
export type FolderContentsInput = z.infer<typeof folderContentsSchema>;

/** The customers' folders in the tree: those with files first, or the ones whose name matches. */
export const customerFoldersSchema = z.object({
  search: z.string().trim().max(100).optional(),
});

/** The note of a version: what changed („Doplnená tabuľka zliav“). */
const versionNoteSchema = z.string().trim().max(300).optional();

const fitsType = (value: { name: string; size: number }) => value.size <= maxBytesOf(value.name);

export const requestUploadSchema = z
  .object({
    folderId: idSchema,
    /** A date at the end of the name becomes the document's date and leaves the name. */
    name: fileNameSchema,
    size: z.number().int().min(1).max(MAX_VIDEO_BYTES),
  })
  .refine(fitsType, { message: 'too_large', path: ['size'] });
export const requestVersionSchema = z
  .object({
    fileId: idSchema,
    /** The name of the uploaded file: its extension must be the file's; a date at its end dates the version. */
    name: fileNameSchema,
    size: z.number().int().min(1).max(MAX_VIDEO_BYTES),
    note: versionNoteSchema,
  })
  .refine(fitsType, { message: 'too_large', path: ['size'] });
export const versionIdSchema = z.object({ versionId: idSchema });
export const fileIdSchema = z.object({ id: idSchema });
export const renameFileSchema = z.object({ id: idSchema, name: fileNameSchema });
export const describeFileSchema = z.object({
  id: idSchema,
  description: z.string().trim().max(1000),
});
export const moveFileSchema = z.object({ id: idSchema, folderId: idSchema });
/** A version (the current one without `versionId`), shown in the browser or saved. */
export const downloadFileSchema = z.object({
  id: idSchema,
  versionId: idSchema.optional(),
  inline: z.boolean().default(false),
});
export const restoreVersionSchema = z.object({ versionId: idSchema });

/** „Vytvoriť dokument“: a template filled for a customer, saved into its folder. */
export const createDocumentSchema = z.object({
  templateId: idSchema,
  customerId: idSchema,
  contactId: idSchema.nullable().optional(),
  name: z.string().trim().min(1).max(190),
  fields: z.record(z.string().max(200), z.string().max(5000)).default({}),
});
