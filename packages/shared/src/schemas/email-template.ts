import { z } from 'zod';
import { idSchema } from './common.js';
import { ACTIVITY_TYPE_INTEREST_ID } from './lead-activity.js';

/** Languages of a template (D-20b): only Slovak is offered at first. */
export const TEMPLATE_LANGUAGES = ['sk'] as const;

/** What a custom field holds; `money` and `date` are formatted at sending. */
export const CUSTOM_FIELD_TYPES = ['text', 'number', 'money', 'date'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
/** `common`: one value for the whole sending; `recipient`: each recipient has their own. */
export const CUSTOM_FIELD_SCOPES = ['common', 'recipient'] as const;

/**
 * The variables every template may use, filled from the contact, the customer and the sender.
 * A custom field is `custom.<key>`.
 */
export const SYSTEM_VARIABLES = [
  'salutation',
  'contact.firstName',
  'contact.lastName',
  'contact.fullName',
  'contact.position',
  'customer.name',
  'customer.city',
  'establishment.name',
  'establishment.address',
  'sender.name',
  'sender.position',
  'sender.phone',
] as const;
export type SystemVariable = (typeof SYSTEM_VARIABLES)[number];

/**
 * Variables that may stay empty without stopping the sending: the prevádzka's, for a person who is
 * at none (docs/establishments.md 8).
 */
export const OPTIONAL_VARIABLES: readonly string[] = [
  'establishment.name',
  'establishment.address',
];

/** A custom field's key, as it appears in `custom.<key>`. */
const fieldKey = z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/, 'invalid');

export const customFieldSchema = z.object({
  key: fieldKey,
  label: z.string().trim().min(1, 'required').max(60, 'too_long'),
  type: z.enum(CUSTOM_FIELD_TYPES),
  scope: z.enum(CUSTOM_FIELD_SCOPES),
});
export type CustomField = z.infer<typeof customFieldSchema>;

const isVariableName = (name: unknown, keys: ReadonlySet<string>) =>
  typeof name === 'string' &&
  ((SYSTEM_VARIABLES as readonly string[]).includes(name) ||
    (name.startsWith('custom.') && keys.has(name.slice('custom.'.length))));

/**
 * The e-mail body: a TipTap document of the blocks the editor offers (D-25). Paragraphs,
 * headings (2, 3), bold, italic, the look's accent colour, lists, links, images from the e-mail
 * image store, the look's logo within a line (D-46), a button, a highlighted block, two columns, a
 * divider, and variables as chips. Anything else is refused.
 */
const NODE_TYPES = [
  'doc',
  'paragraph',
  'heading',
  'text',
  'bulletList',
  'orderedList',
  'listItem',
  'hardBreak',
  'horizontalRule',
  'image',
  'button',
  'callout',
  'columns',
  'column',
  'variable',
  'logo',
] as const;
const MARK_TYPES = ['bold', 'italic', 'link', 'accent'] as const;
const MAX_DOC_CHARS = 200_000;

export const safeHref = (href: unknown) =>
  typeof href === 'string' && /^(https?:\/\/|mailto:)/i.test(href) && href.length <= 2000;
/** An e-mail image is referenced by its key in the image store, never by an outside URL. */
export const IMAGE_KEY = /^[A-Za-z0-9_-]{16,64}\.(png|jpg|webp)$/;

export interface EmailNode {
  type: (typeof NODE_TYPES)[number];
  attrs?: Record<string, unknown> | undefined;
  content?: EmailNode[] | undefined;
  text?: string | undefined;
  marks?:
    | { type: (typeof MARK_TYPES)[number]; attrs?: Record<string, unknown> | undefined }[]
    | undefined;
}

const nodeSchema: z.ZodType<EmailNode> = z.lazy(() =>
  z.object({
    type: z.enum(NODE_TYPES),
    attrs: z.record(z.unknown()).optional(),
    content: z.array(nodeSchema).max(2000).optional(),
    text: z.string().max(MAX_DOC_CHARS).optional(),
    marks: z
      .array(z.object({ type: z.enum(MARK_TYPES), attrs: z.record(z.unknown()).optional() }))
      .max(10)
      .optional(),
  }),
);

const anId = (value: unknown) =>
  typeof value === 'string' && idSchema.safeParse(value).success ? value : null;

/**
 * What a button records (docs/activity-types.md): `attrs.activityTypeId` and, when the type asks for
 * one, `attrs.productId`. A document saved before the types has `attrs.interestProductId`, which
 * means interest in that product. The recipient's own link is made at sending, so such a button has
 * no address.
 */
export const recordedActivityOf = (
  node: EmailNode,
): { typeId: string; productId: string | null } | null => {
  if (node.type !== 'button') return null;
  const typeId = anId(node.attrs?.activityTypeId);
  if (typeId) return { typeId, productId: anId(node.attrs?.productId) };
  const productId = anId(node.attrs?.interestProductId);
  return productId ? { typeId: ACTIVITY_TYPE_INTEREST_ID, productId } : null;
};

/** Every node that carries something to check: links, images, buttons, variables. */
function* walk(node: EmailNode): Generator<EmailNode> {
  yield node;
  for (const child of node.content ?? []) yield* walk(child);
}

/** Whether a document has a button that records an activity. */
export const hasActivityButton = (doc: EmailNode) =>
  [...walk(doc)].some((node) => recordedActivityOf(node) !== null);

/** Why a document is refused, or `null`. `keys`: the template's custom field keys. */
export function emailDocProblem(doc: EmailNode, keys: ReadonlySet<string>): string | null {
  if (doc.type !== 'doc') return 'invalid';
  if (JSON.stringify(doc).length > MAX_DOC_CHARS) return 'too_long';
  for (const node of walk(doc)) {
    for (const mark of node.marks ?? []) {
      if (mark.type === 'link' && !safeHref(mark.attrs?.href)) return 'invalid_link';
    }
    if (node.type === 'button' && !recordedActivityOf(node) && !safeHref(node.attrs?.href)) {
      return 'invalid_link';
    }
    if (
      node.type === 'image' &&
      !(typeof node.attrs?.src === 'string' && IMAGE_KEY.test(node.attrs.src))
    ) {
      return 'invalid_image';
    }
    // A logo within a line: its own picture, or without one the look's.
    if (
      node.type === 'logo' &&
      node.attrs?.src != null &&
      !(typeof node.attrs.src === 'string' && IMAGE_KEY.test(node.attrs.src))
    ) {
      return 'invalid_image';
    }
    if (node.type === 'variable' && !isVariableName(node.attrs?.name, keys)) {
      return 'unknown_variable';
    }
    if (node.type === 'heading' && ![2, 3].includes(node.attrs?.level as number)) return 'invalid';
  }
  return null;
}

export const emailDocSchema = nodeSchema;

/** The variables a document uses, in order of appearance, each once. */
export function variablesOf(doc: EmailNode | null | undefined): string[] {
  if (!doc) return [];
  const names: string[] = [];
  for (const node of walk(doc)) {
    const name = node.attrs?.name;
    if (node.type === 'variable' && typeof name === 'string' && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

export const templateInputSchema = z
  .object({
    name: z.string().trim().min(1, 'required').max(120, 'too_long'),
    categoryId: idSchema.nullable(),
    language: z.enum(TEMPLATE_LANGUAGES).default('sk'),
    /** One paragraph of text and variables. */
    subject: emailDocSchema,
    body: emailDocSchema,
    customFields: z.array(customFieldSchema).max(20).default([]),
    /** Whose look its e-mails wear: a product's, or NULL for the global one. */
    lookProductId: idSchema.nullable().default(null),
    /** Files of the Files module offered as attachments when sending; their current version. */
    attachmentFileIds: z.array(idSchema).max(10).default([]),
    active: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    const keys = new Set(value.customFields.map((field) => field.key));
    if (keys.size !== value.customFields.length) {
      ctx.addIssue({ code: 'custom', path: ['customFields'], message: 'duplicate' });
    }
    for (const [path, doc] of [
      ['subject', value.subject],
      ['body', value.body],
    ] as const) {
      const problem = emailDocProblem(doc, keys);
      if (problem) ctx.addIssue({ code: 'custom', path: [path], message: problem });
    }
  });
export type TemplateInput = z.input<typeof templateInputSchema>;
export type TemplateValues = z.output<typeof templateInputSchema>;

export const templateIdSchema = z.object({ id: idSchema });
export const updateTemplateSchema = z.object({ id: idSchema, template: templateInputSchema });
export const templateListSchema = z.object({
  categoryId: z.union([idSchema, z.literal('inactive')]).optional(),
  search: z.string().trim().max(100).optional(),
});

/** A preview: the stored template, or the one being edited, filled for one contact. */
export const templatePreviewSchema = z.object({
  subject: emailDocSchema,
  body: emailDocSchema,
  customFields: z.array(customFieldSchema).max(20).default([]),
  contactId: idSchema.optional(),
  lookProductId: idSchema.nullable().default(null),
  /** Values typed for the custom fields, by key; empty ones stay missing. */
  values: z.record(z.string().max(500)).default({}),
});

/** Settings › Vzhľad e-mailov. */
export const HEADER_STYLES = ['dark', 'light'] as const;
export const ACCENT_COLORS = ['#0f766e', '#0c3b3c', '#0d7f81', '#b45309', '#334e7b'] as const;
/**
 * Where a customer's reply goes (the Reply-To of e-mails to customers): back to Intra on the
 * message's own address (needs the inbound domain), to the company address, or to the sender.
 */
export const REPLY_MODES = ['intra', 'company', 'sender'] as const;
export type ReplyMode = (typeof REPLY_MODES)[number];

/** Whether a document has only these nodes, without any mark but these. */
const limitedTo = (nodes: readonly string[], marks: readonly string[]) => (doc: EmailNode) => {
  const fine = (node: EmailNode): boolean =>
    nodes.includes(node.type) &&
    (node.marks ?? []).every((mark) => marks.includes(mark.type)) &&
    (node.content ?? []).every(fine);
  return fine(doc);
};
const lengthOf = (node: EmailNode): number =>
  (node.text?.length ?? 0) + (node.content ?? []).reduce((sum, child) => sum + lengthOf(child), 0);

/** The text in an e-mail's header: lines of text, bold or italic. */
export const headerDocSchema = emailDocSchema
  .refine(limitedTo(['doc', 'paragraph', 'text', 'hardBreak'], ['bold', 'italic']), 'invalid')
  .refine((doc) => lengthOf(doc) <= 400, 'too_long');
/** The name an e-mail is from: one line of text and variables, as the subject. */
export const senderNameDocSchema = emailDocSchema
  .refine(limitedTo(['doc', 'paragraph', 'text', 'variable'], []), 'invalid')
  .refine((doc) => lengthOf(doc) <= 120, 'too_long');

export const emailLookSchema = z.object({
  logoKey: z.string().regex(IMAGE_KEY).nullable(),
  headerStyle: z.enum(HEADER_STYLES),
  brandName: z.string().trim().min(1, 'required').max(60, 'too_long'),
  headerDoc: headerDocSchema.nullable(),
  /** Who the e-mail is from; NULL: the brand and the company (D-50). */
  senderNameDoc: senderNameDocSchema.nullable(),
  accent: z.enum(ACCENT_COLORS),
  footerCompany: z.string().trim().max(200, 'too_long'),
  footerIco: z.string().trim().max(20, 'too_long'),
  footerWeb: z.string().trim().max(120, 'too_long'),
  footerEmail: z.union([z.literal(''), z.string().trim().email('invalid_email').max(120)]),
  replyMode: z.enum(REPLY_MODES),
  replyToAddress: z.string().trim().email('invalid_email').max(120),
});
export type EmailLook = z.infer<typeof emailLookSchema>;

/**
 * Who an e-mail is from in the recipient's inbox (D-50): the name written in Settings › Vzhľad
 * e-mailov, else „Alma ADOS | Alma Care Solutions“, the brand and the company's name. Its variables
 * take `values` when it goes out, and a name with a value missing falls back on the brand and the
 * company; without values, in a screen, a variable shows by its `label`.
 */
export function senderNameOf(
  look: Pick<EmailLook, 'brandName' | 'footerCompany' | 'senderNameDoc'>,
  fill: {
    values?: Readonly<Record<string, string | undefined>>;
    optional?: readonly string[];
    label?: (name: string) => string;
  } = {},
) {
  const brand = look.brandName.trim();
  const company = look.footerCompany.trim();
  const fallback = company && company !== brand ? `${brand} | ${company}` : brand;
  let complete = true;
  const walk = (node: EmailNode): string => {
    if (node.type === 'text') return node.text ?? '';
    if (node.type === 'variable') {
      const name = typeof node.attrs?.name === 'string' ? node.attrs.name : '';
      if (fill.values) {
        const value = fill.values[name]?.trim();
        if (!value && !fill.optional?.includes(name)) complete = false;
        return value ?? '';
      }
      return fill.label ? fill.label(name) : name;
    }
    return (node.content ?? []).map(walk).join('');
  };
  const written = look.senderNameDoc ? walk(look.senderNameDoc).replace(/\s+/g, ' ').trim() : '';
  return written && complete ? written : fallback;
}

/**
 * The brand's name in the header of an e-mail: the words after the first stand out (D-48), on a
 * dark header in a light colour, as the accents are too dark to read there, on a light one in the
 * accent.
 */
export function brandParts(look: Pick<EmailLook, 'brandName' | 'headerStyle' | 'accent'>) {
  const [first = '', ...rest] = look.brandName.split(' ');
  return {
    first,
    rest: rest.join(' '),
    restColor: look.headerStyle === 'dark' ? '#5fd0c9' : look.accent,
  };
}

/**
 * A product's own look (D-39): what it sets over the global one. The company's name, its IČO, the
 * sending address and where replies go stay common.
 */
export const productLookSchema = emailLookSchema
  .pick({
    logoKey: true,
    headerStyle: true,
    brandName: true,
    headerDoc: true,
    senderNameDoc: true,
    accent: true,
    footerWeb: true,
    footerEmail: true,
  })
  .extend({ enabled: z.boolean() });
export type ProductLook = z.infer<typeof productLookSchema>;
export const saveProductLookSchema = z.object({ productId: idSchema, look: productLookSchema });
export const effectiveLookSchema = z.object({ productId: idSchema.nullable() });

/** An image for e-mails, resized in the browser; its bytes go straight to the bucket. */
export const EMAIL_IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
} as const;
export const MAX_EMAIL_IMAGE_BYTES = 2 * 1024 * 1024;
export const requestImageSchema = z.object({
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  size: z.number().int().min(1).max(MAX_EMAIL_IMAGE_BYTES),
  width: z.number().int().min(1).max(4000),
  height: z.number().int().min(1).max(4000),
});
export const confirmImageSchema = z.object({ id: idSchema });
/** A picture from the Files module, copied among the images of e-mails (D-49). */
export const imageFromFileSchema = z.object({ fileId: idSchema });
