import { z } from 'zod';
import { idSchema } from './common.js';
import { isoDateSchema } from './file.js';

/** What a visitor of a shared file may do: each mode includes the ones before it (docs/file-sharing.md). */
export const SHARE_MODES = ['read', 'comment', 'edit'] as const;
export type ShareMode = (typeof SHARE_MODES)[number];

export const SHARE_PASSWORD_MIN = 8;
/** The limits of what an outsider sends ([S-34]). */
export const SHARE_LIMITS = {
  name: 80,
  comment: 4000,
  changes: 200,
  fragmentBytes: 256 * 1024,
  draftBytes: 5 * 1024 * 1024,
  /** A larger document can be read and commented on, not edited. */
  editableBytes: 10 * 1024 * 1024,
} as const;

export const shareFileIdSchema = z.object({ fileId: idSchema });

/**
 * Creates or changes a file's one link. An empty `password` keeps the one set; `null` removes it.
 * Only „Čítanie“ goes without a password, and only an HTML file has the other modes (the service
 * checks both, it knows the file).
 */
export const saveShareSchema = z.object({
  fileId: idSchema,
  mode: z.enum(SHARE_MODES),
  password: z
    .string()
    .min(SHARE_PASSWORD_MIN, 'too_short')
    .max(200, 'too_long')
    .nullable()
    .optional(),
  expiresOn: isoDateSchema.nullable().optional(),
});

/** The token of a link: 256 random bits, base64url. Always in a POST body, never in an address. */
const shareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'invalid');
export const publicShareSchema = z.object({ token: shareTokenSchema });

const visitorNameSchema = z
  .string()
  .trim()
  .min(2, 'too_short')
  .max(SHARE_LIMITS.name, 'too_long')
  .refine((value) => ![...value].some((c) => c.charCodeAt(0) < 0x20), 'invalid');

export const unlockShareSchema = publicShareSchema.extend({
  /** Only when the link asks for it and this browser is not recognized. */
  name: visitorNameSchema.optional(),
  password: z.string().max(200).optional(),
});

export const fragmentSchema = publicShareSchema.extend({ block: z.number().int().min(0) });

const changeOpSchema = z.object({
  block: z.number().int().min(0),
  /** `edit` needs the fragment's new HTML, `text` the runs of text that changed. */
  kind: z.enum(['edit', 'delete', 'text']),
  html: z.string().max(SHARE_LIMITS.fragmentBytes).optional(),
  texts: z
    .array(
      z.object({
        i: z.number().int().min(0),
        text: z.string().max(SHARE_LIMITS.fragmentBytes),
      }),
    )
    .max(5000)
    .optional(),
});

export const saveDraftSchema = publicShareSchema.extend({
  baseVersionId: idSchema,
  ops: z.array(changeOpSchema).min(1).max(SHARE_LIMITS.changes),
});

/** Where a comment belongs: the block, the quoted text around it, or an element by its tag and picture. */
export const commentAnchorSchema = z.object({
  block: z.number().int().min(0).nullable(),
  quote: z.string().max(2000).nullable(),
  prefix: z.string().max(200).nullable(),
  suffix: z.string().max(200).nullable(),
  tag: z.string().max(20).nullable(),
  src: z.string().max(2000).nullable(),
});
export type CommentAnchor = z.infer<typeof commentAnchorSchema>;

const commentBodySchema = z
  .string()
  .trim()
  .min(1, 'required')
  .max(SHARE_LIMITS.comment, 'too_long');

export const addCommentSchema = publicShareSchema.extend({
  body: commentBodySchema,
  anchor: commentAnchorSchema.nullable().optional(),
  parentId: idSchema.nullable().optional(),
});
export const editCommentSchema = publicShareSchema.extend({
  id: idSchema,
  body: commentBodySchema,
});
export const deleteCommentSchema = publicShareSchema.extend({ id: idSchema });

/** What a colleague edits: the file, and one opening of the editor. */
export const colleagueFileSchema = z.object({ fileId: idSchema, sessionId: idSchema });
export const colleagueFragmentSchema = z.object({
  fileId: idSchema,
  block: z.number().int().min(0),
});
export const colleagueAddCommentSchema = colleagueFileSchema.extend({
  body: commentBodySchema,
  anchor: commentAnchorSchema.nullable().optional(),
  parentId: idSchema.nullable().optional(),
});
export const colleagueCommentSchema = z.object({ id: idSchema, body: commentBodySchema });
export const colleagueSaveSchema = colleagueFileSchema.extend({
  baseVersionId: idSchema,
  mode: z.enum(['version', 'draft']),
  ops: z.array(changeOpSchema).min(1).max(SHARE_LIMITS.changes),
});

export const draftIdSchema = z.object({ id: idSchema });
export const draftDecisionSchema = z.object({
  changeId: idSchema,
  decision: z.enum(['approved', 'rejected', 'pending']),
});
export const draftReplySchema = z.object({ commentId: idSchema, body: commentBodySchema });
export const draftCommentSchema = z.object({ commentId: idSchema });
export const mergeDraftsSchema = z.object({
  fileId: idSchema,
  ids: z.array(idSchema).min(2).max(50),
});
