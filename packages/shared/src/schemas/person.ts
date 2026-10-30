import { z } from 'zod';
import { TIMELINE_FILTERS } from './activity.js';
import { emailSchema, idSchema, PAGE_SIZE } from './common.js';
import { contactSchema, oneOrMore } from './customer.js';

/**
 * Kontakty: natural persons on their own (docs/contacts-redesign.md). A person may work at several
 * organizations, with a position at each, or at none.
 */

/** Where a person works, for the list's filter: at a customer, at a partner, or nowhere. */
export const PERSON_LINKS = ['customer', 'partner', 'none'] as const;
export type PersonLink = (typeof PERSON_LINKS)[number];

/** A person's e-mail state, for the list's filter. */
export const PERSON_EMAIL_STATES = ['unsubscribed', 'invalid'] as const;

export const PERSON_SORTS = ['name', 'lastContact'] as const;

export const personListSchema = z.object({
  search: z.string().trim().max(100).optional(),
  link: oneOrMore(z.enum(PERSON_LINKS)),
  organizationId: oneOrMore(idSchema),
  emailState: oneOrMore(z.enum(PERSON_EMAIL_STATES)),
  sort: z.enum(PERSON_SORTS).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(PAGE_SIZE),
});
export type PersonListInput = z.input<typeof personListSchema>;

/** The person's own data; the position belongs to each organization. */
export const personSchema = contactSchema.omit({ position: true });
export type PersonInput = z.infer<typeof personSchema>;

/** The person at one organization. */
export const personLinkSchema = z.object({
  customerId: idSchema,
  position: contactSchema.shape.position,
  /** The organization's primary contact, its default recipient. */
  isPrimary: z.boolean().default(false),
});

export const createPersonSchema = z.object({
  person: personSchema,
  /** Off: no marketing e-mails; replies still go to them. */
  receivesBulk: z.boolean().default(true),
  links: z.array(personLinkSchema).max(20).default([]),
});

export const updatePersonSchema = z.object({
  id: idSchema,
  person: personSchema,
  receivesBulk: z.boolean(),
});

export const linkPersonSchema = personLinkSchema.extend({ id: idSchema });
export const unlinkPersonSchema = z.object({ id: idSchema, customerId: idSchema });

/** „Používateľ aplikácie“: who can be added to this organization (D-47). */
export const userCandidatesSchema = z.object({ customerId: idSchema });
export const addUserContactSchema = personLinkSchema.extend({
  userId: idSchema,
  /** A contact with the user's e-mail exists and the dialog has shown what connecting it changes. */
  connect: z.boolean().default(false),
});
export type AddUserContactInput = z.infer<typeof addUserContactSchema>;
export const personIdSchema = z.object({ id: idSchema });
/** „Osoba s týmto e-mailom už v Kontaktoch je“: who has the address. */
export const personByEmailSchema = z.object({ email: emailSchema });
export const personTimelineSchema = z.object({
  id: idSchema,
  filter: z.enum(TIMELINE_FILTERS).default('all'),
});
