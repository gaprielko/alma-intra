import { z } from 'zod';
import { idSchema } from './common.js';

/** Signed URLs are short-lived: long enough for one upload or one download, no more. */
export const FILE_URL_TTL_SECONDS = { upload: 600, download: 300 } as const;

/** At most 50 MB per file. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

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
  zip: { mime: 'application/zip', group: 'archive', preview: false },
} as const satisfies Record<string, { mime: string; group: FileGroup; preview: boolean }>;
export type FileExtension = keyof typeof FILE_TYPES;

/** The extension of a name, lower case, or `null` when it is not one of the allowed. */
export function fileExtension(name: string): FileExtension | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(name);
  const ext = match?.[1]?.toLowerCase();
  return ext !== undefined && Object.hasOwn(FILE_TYPES, ext) ? (ext as FileExtension) : null;
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
});
export type FolderContentsInput = z.infer<typeof folderContentsSchema>;

/** The customers' folders in the tree: those with files first, or the ones whose name matches. */
export const customerFoldersSchema = z.object({
  search: z.string().trim().max(100).optional(),
});

/** The note of a version: what changed („Doplnená tabuľka zliav“). */
const versionNoteSchema = z.string().trim().max(300).optional();

export const requestUploadSchema = z.object({
  folderId: idSchema,
  name: fileNameSchema,
  size: z.number().int().min(1).max(MAX_FILE_BYTES),
});
export const requestVersionSchema = z.object({
  fileId: idSchema,
  /** The name of the uploaded file: its extension must be the file's. */
  name: fileNameSchema,
  size: z.number().int().min(1).max(MAX_FILE_BYTES),
  note: versionNoteSchema,
});
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
