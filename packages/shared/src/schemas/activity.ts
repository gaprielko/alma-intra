import { z } from 'zod';
import { idSchema } from './common.js';

/** What happened with the customer outside the app. A code list may replace this later. */
export const ACTIVITY_KINDS = ['call', 'meeting', 'video_call', 'note'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** What a customer's timeline shows. `emails` stays empty until sending (E5) exists. */
export const TIMELINE_FILTERS = ['all', 'activities', 'emails', 'notes', 'changes'] as const;
export type TimelineFilter = (typeof TIMELINE_FILTERS)[number];

/**
 * Formatted notes: a TipTap document limited to what the editor offers (paragraphs, bold,
 * italic, lists, links, line breaks). Anything else is refused, so what is stored is what the
 * editor can show, and a link is always http(s) or mailto.
 */
const NODE_TYPES = [
  'doc',
  'paragraph',
  'text',
  'bulletList',
  'orderedList',
  'listItem',
  'hardBreak',
] as const;
const MARK_TYPES = ['bold', 'italic', 'link'] as const;
const MAX_DOC_CHARS = 50_000;

const safeHref = (href: string) => /^(https?:\/\/|mailto:)/i.test(href);

const markSchema = z
  .object({
    type: z.enum(MARK_TYPES),
    attrs: z.record(z.unknown()).optional(),
  })
  .refine(
    (mark) =>
      mark.type !== 'link' || (typeof mark.attrs?.href === 'string' && safeHref(mark.attrs.href)),
    'invalid_link',
  );

export interface RichNode {
  type: (typeof NODE_TYPES)[number];
  attrs?: Record<string, unknown> | undefined;
  content?: RichNode[] | undefined;
  text?: string | undefined;
  marks?: z.infer<typeof markSchema>[] | undefined;
}

const nodeSchema: z.ZodType<RichNode> = z.lazy(() =>
  z.object({
    type: z.enum(NODE_TYPES),
    attrs: z.record(z.unknown()).optional(),
    content: z.array(nodeSchema).max(2000).optional(),
    text: z.string().max(MAX_DOC_CHARS).optional(),
    marks: z.array(markSchema).max(10).optional(),
  }),
);

export const richTextSchema = nodeSchema.refine(
  (doc) => doc.type === 'doc' && JSON.stringify(doc).length <= MAX_DOC_CHARS,
  'too_long',
);
export type RichText = RichNode;

/** The plain text of a document: for the timeline's preview and the search. */
export function richTextToPlain(node: RichNode | null | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  const inner = (node.content ?? []).map(richTextToPlain).join(node.type === 'doc' ? '\n' : '');
  return node.type === 'listItem' ? `${inner}\n` : inner;
}

/** A due date as the date picker gives it: `2026-10-31`. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid');

export const nextStepSchema = z.object({
  text: z.string().trim().min(1, 'required').max(300, 'too_long'),
  due: isoDate.optional(),
  assigneeId: idSchema.optional(),
});
export type NextStepInput = z.infer<typeof nextStepSchema>;

/**
 * An attachment: a file of the Files module and the version the activity keeps. Without
 * `versionId`, the file's current version when the activity is saved.
 */
const attachmentSchema = z.object({ fileId: idSchema, versionId: idSchema.optional() });

export const activitySchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  occurredAt: z.coerce.date(),
  durationMin: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .optional(),
  subject: z.string().trim().max(200, 'too_long').optional(),
  body: richTextSchema.optional(),
  contactIds: z.array(idSchema).max(50).default([]),
  userIds: z.array(idSchema).max(50).default([]),
  attachments: z.array(attachmentSchema).max(20).default([]),
  nextStep: nextStepSchema.nullable().default(null),
  /**
   * „Patrí k“: the organization or one of its prevádzky the activity belongs to; left out, it is
   * found from the participants (docs/establishments.md 7).
   */
  organizationId: idSchema.optional(),
});
export type ActivityInput = z.input<typeof activitySchema>;
export type ActivityValues = z.output<typeof activitySchema>;

export const createActivitySchema = z.object({ customerId: idSchema, activity: activitySchema });
export const updateActivitySchema = z.object({ id: idSchema, activity: activitySchema });
export const activityIdSchema = z.object({ id: idSchema });
export const nextStepDoneSchema = z.object({ id: idSchema, done: z.boolean() });

export const timelineSchema = z.object({
  customerId: idSchema,
  filter: z.enum(TIMELINE_FILTERS).default('all'),
  /** „Aj prevádzky“: an organization's timeline with the entries of its prevádzky. */
  withEstablishments: z.boolean().default(true),
});

/**
 * Files offered to attach: the customer's folders or the company's, by name. A template has no
 * customer: only the company's documents.
 */
export const pickableFilesSchema = z.object({
  scope: z.enum(['customer', 'company']),
  customerId: idSchema.optional(),
  search: z.string().trim().max(100).optional(),
});
