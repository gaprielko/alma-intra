import { z } from 'zod';
import { emailSchema, idSchema, PAGE_SIZE, phoneSchema } from './common.js';

/**
 * What a customer is, chosen first and never changed: a company with contact persons, or a private
 * person who is their own contact.
 */
export const CUSTOMER_KINDS = ['organization', 'individual'] as const;
export type CustomerKind = (typeof CUSTOMER_KINDS)[number];

/** What an organization is to Alma: a customer, or a partner (docs/contacts-redesign.md). */
export const ORGANIZATION_ROLES = ['customer', 'partner'] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/** Where the business relationship stands; `not_interested` ends it without a sale. */
export const CUSTOMER_STATUSES = [
  'lead',
  'contacted',
  'interested',
  'customer',
  'former_customer',
  'not_interested',
] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/** The eight self-governing regions of Slovakia, for filtering. */
export const REGIONS = [
  'bratislava',
  'trnava',
  'trencin',
  'nitra',
  'zilina',
  'banska_bystrica',
  'presov',
  'kosice',
] as const;
export type Region = (typeof REGIONS)[number];

/** How a person is addressed: „pán“ or „pani“. */
export const GENDERS = ['male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];

/** Whether e-mails reach the address; set by delivery reports, never typed. */
export const EMAIL_STATUSES = ['ok', 'bounced', 'complained'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/** Optional text: an empty field is stored as nothing. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));
const optionalEmail = emailSchema
  .or(z.literal(''))
  .optional()
  .transform((v) => (v ? v : undefined));
const optionalPhone = phoneSchema
  .or(z.literal(''))
  .optional()
  .transform((v) => (v ? v : undefined));

/** IČO: eight digits, typed with or without spaces. */
const icoSchema = z
  .string()
  .transform((v) => v.replace(/\s/g, ''))
  .pipe(z.string().regex(/^\d{8}$/, 'invalid_ico'));
const optionalIco = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .pipe(icoSchema.optional());

/** An IČO to look up in the business register. */
export const icoLookupSchema = z.object({ ico: icoSchema });

/** The fields of a person, shared by a contact and a private-person customer. */
export const personFields = {
  titleBefore: optionalText(40),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  titleAfter: optionalText(40),
  gender: z.enum(GENDERS).optional(),
  /** The exact words an e-mail opens with („Vážená pani riaditeľka“). */
  salutation: optionalText(120),
  email: optionalEmail,
  phone: optionalPhone,
};

/** Where a customer sits, how it is classified and who has it in hand. */
const classificationFields = {
  /** A customer or a partner (D-1); a partner's kind of cooperation is a tag (D-4). */
  role: z.enum(ORGANIZATION_ROLES),
  /** ADOS, DOS, Stacionár, …: a customer's only (the server drops them for a partner). */
  productIds: z.array(idSchema).max(20).default([]),
  /** A customer's only, and empty until set (D-6). */
  status: z.enum(CUSTOMER_STATUSES).optional().nullable(),
  street: optionalText(160),
  postalCode: optionalText(12),
  city: optionalText(80),
  region: z.enum(REGIONS).optional().nullable(),
  /** A customer's only (D-10). */
  ownerUserId: idSchema.optional().nullable(),
  sourceId: idSchema.optional().nullable(),
  /** Tag names; a new name becomes a tag. */
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  note: optionalText(4000),
  /** The organization's id in Alma ADOS, for reference only. */
  almaOrganizationId: optionalText(80),
};

export const contactSchema = z.object({
  ...personFields,
  position: optionalText(120),
  note: optionalText(2000),
});
export type ContactInput = z.infer<typeof contactSchema>;

export const organizationCustomerSchema = z.object({
  kind: z.literal('organization'),
  name: z.string().trim().min(2).max(200),
  ico: optionalIco,
  dic: optionalText(12),
  icDph: optionalText(14),
  web: optionalText(200),
  email: optionalEmail,
  phone: optionalPhone,
  ...classificationFields,
});

export const individualCustomerSchema = z.object({
  kind: z.literal('individual'),
  ...personFields,
  ...classificationFields,
  /** Off: no marketing e-mails; replies still go to them. */
  receivesBulk: z.boolean().default(true),
});

export const customerSchema = z.discriminatedUnion('kind', [
  organizationCustomerSchema,
  individualCustomerSchema,
]);
export type CustomerInput = z.infer<typeof customerSchema>;

/** A new customer, optionally with its first (and so primary) contact. */
export const createCustomerSchema = z.object({
  customer: customerSchema,
  firstContact: contactSchema.optional(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

/** The kind is part of the input so the right fields are checked; it cannot change. */
export const updateCustomerSchema = z.object({ id: idSchema, customer: customerSchema });
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const customerIdSchema = z.object({ id: idSchema });

export const CUSTOMER_SORTS = ['name', 'status', 'createdAt', 'updatedAt', 'lastContact'] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

/** The filters of the list; also what a CSV export and (later) a saved segment are made of. */
/**
 * One value or several (D-12): every dropdown filter of the lists takes any number of them. A
 * single value, as saved segments and older links have it, reads as a list of one.
 */
export const oneOrMore = <T extends z.ZodTypeAny>(item: T) =>
  z
    .union([item, z.array(item).min(1).max(50)])
    .transform((value): z.output<T>[] => (Array.isArray(value) ? value : [value]))
    .optional();

export const customerFilterSchema = z.object({
  search: z.string().trim().max(100).optional(),
  /** Customers or partners (docs/contacts-redesign.md). */
  role: z.enum(ORGANIZATION_ROLES).optional(),
  /** Statuses, `none` for the records without one. */
  status: oneOrMore(z.enum(CUSTOMER_STATUSES).or(z.literal('none'))),
  kind: oneOrMore(z.enum(CUSTOMER_KINDS)),
  /** Products, `none` for the records without any. */
  productId: oneOrMore(idSchema.or(z.literal('none'))),
  region: oneOrMore(z.enum(REGIONS)),
  tagId: oneOrMore(idSchema),
  ownerUserId: oneOrMore(idSchema),
});
export type CustomerFilter = z.infer<typeof customerFilterSchema>;

export const customerListSchema = customerFilterSchema.extend({
  sort: z.enum(CUSTOMER_SORTS).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(PAGE_SIZE),
});
export type CustomerListInput = z.input<typeof customerListSchema>;

/** Several customers picked in the list. */
const selection = z.array(idSchema).min(1).max(100);

/** „Zmeniť na zákazníka“ / „Zmeniť na partnera“ (D-5). */
export const setRoleSchema = z.object({ id: idSchema, role: z.enum(ORGANIZATION_ROLES) });

export const bulkTagSchema = z.object({ ids: selection, tag: z.string().trim().min(1).max(40) });
export const bulkStatusSchema = z.object({ ids: selection, status: z.enum(CUSTOMER_STATUSES) });

/** The picked customers, or with no `ids` everything the filters find. */
export const exportCustomersSchema = customerFilterSchema.extend({
  ids: selection.optional(),
});

export const createContactSchema = z.object({ customerId: idSchema, contact: contactSchema });
export const updateContactSchema = z.object({
  id: idSchema,
  /** The organization the person is edited at: the position is theirs there. */
  customerId: idSchema,
  contact: contactSchema,
  /** Off: no marketing e-mails; replies still go to them. */
  receivesBulk: z.boolean(),
});
/** A person at one organization (a person may belong to several). */
export const contactIdSchema = z.object({ id: idSchema, customerId: idSchema });

/** Contact types, products and sources: a name each, offered in the forms while active. */
export const CODE_LISTS = ['product', 'source', 'template_category'] as const;
export type CodeList = (typeof CODE_LISTS)[number];

export const codeListSchema = z.object({ list: z.enum(CODE_LISTS) });
export const codeItemNameSchema = z.string().trim().min(1).max(80);
export const createCodeItemSchema = z.object({
  list: z.enum(CODE_LISTS),
  name: codeItemNameSchema,
});
export const updateCodeItemSchema = z.object({
  list: z.enum(CODE_LISTS),
  id: idSchema,
  name: codeItemNameSchema,
  active: z.boolean(),
});
export const codeItemIdSchema = z.object({ list: z.enum(CODE_LISTS), id: idSchema });
export const reorderCodeItemsSchema = z.object({
  list: z.enum(CODE_LISTS),
  ids: z.array(idSchema).min(1).max(200),
});
export const renameTagSchema = z.object({ id: idSchema, name: z.string().trim().min(1).max(40) });
export const tagIdSchema = z.object({ id: idSchema });

/**
 * The opening line an e-mail to a person starts with, offered when it is empty: the position if
 * there is one („Vážená pani riaditeľka“), else the surname („Vážený pán Novák“).
 */
export function suggestSalutation(person: {
  gender?: Gender | undefined;
  lastName?: string | undefined;
  position?: string | undefined;
}): string {
  if (!person.gender) return '';
  const dear = person.gender === 'female' ? 'Vážená pani' : 'Vážený pán';
  const position = person.position?.trim().toLocaleLowerCase('sk');
  const name = person.lastName?.trim();
  if (position) return `${dear} ${position}`;
  return name ? `${dear} ${name}` : '';
}

/** „Mgr. Eva Tóthová, PhD.“ */
export function personName(p: {
  titleBefore?: string | null | undefined;
  firstName: string;
  lastName: string;
  titleAfter?: string | null | undefined;
}): string {
  const core = [p.titleBefore, p.firstName, p.lastName].filter(Boolean).join(' ');
  return p.titleAfter ? `${core}, ${p.titleAfter}` : core;
}

/** A saved segment (D-7): the list's filters under a name, for oneself or shared. */
export const segmentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  filters: customerFilterSchema,
  shared: z.boolean().default(false),
});
export const updateSegmentSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(80),
  shared: z.boolean(),
});
export const segmentIdSchema = z.object({ id: idSchema });
