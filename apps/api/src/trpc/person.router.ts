import {
  addUserContactSchema,
  createPersonSchema,
  linkPersonSchema,
  personByEmailSchema,
  personIdSchema,
  personListSchema,
  personTimelineSchema,
  unlinkPersonSchema,
  updatePersonSchema,
  userCandidatesSchema,
} from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import { timelineOf } from '../activities/activities.service.js';
import { CustomerError } from '../customers/customers.service.js';
import * as persons from '../customers/persons.service.js';
import type { Context } from './context.js';
import { authorizedProcedure, router } from './trpc.js';

/** The service's refusals as tRPC errors, with the code as message for the web to word. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof CustomerError)) throw error;
    const code =
      error.code === 'NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'CONTACT_EMAIL_TAKEN'
          ? 'CONFLICT'
          : 'BAD_REQUEST';
    throw new TRPCError({ code, message: error.code });
  }
}

/** A person put at or taken off an organization is news in the organization's history. */
const auditOrganization = (ctx: Context, id: string, diff: Record<string, unknown>) =>
  ctx.audit.set({ entityType: 'customer', entityId: id, diff });

/**
 * Kontakty: natural persons on their own, at any number of organizations (docs/contacts-redesign.md).
 * The person's own changes are the person's history; where they work is the organizations'.
 */
export const personRouter = router({
  list: authorizedProcedure('customer.read')
    .input(personListSchema)
    .query(({ ctx, input }) => persons.listPersons(ctx.db, input)),

  get: authorizedProcedure('customer.read')
    .input(personIdSchema)
    .query(({ ctx, input }) => run(() => persons.getPerson(ctx.db, input.id))),

  /** „Osoba s týmto e-mailom už v Kontaktoch je“, while the form is typed. */
  byEmail: authorizedProcedure('customer.read')
    .input(personByEmailSchema)
    .query(({ ctx, input }) => persons.personByEmail(ctx.db, input.email)),

  /** The person's own timeline (D-8). */
  timeline: authorizedProcedure('customer.read')
    .input(personTimelineSchema)
    .query(async ({ ctx, input }) => {
      await run(() => persons.getPerson(ctx.db, input.id));
      return timelineOf(ctx.db, { contactId: input.id }, input.filter);
    }),

  create: authorizedProcedure('customer.write')
    .input(createPersonSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await run(() => persons.createPerson(ctx.db, input));
      ctx.audit.set({
        entityType: 'person',
        entityId: created.id,
        diff: { created: true, count: created.customerIds.length },
      });
      return { id: created.id };
    }),

  update: authorizedProcedure('customer.write')
    .input(updatePersonSchema)
    .mutation(async ({ ctx, input }) => {
      const change = await run(() =>
        persons.updatePerson(ctx.db, input.id, input.person, input.receivesBulk),
      );
      ctx.audit.set({ entityType: 'person', entityId: input.id, diff: { fields: change.fields } });
      return { ok: true as const };
    }),

  /** „Používateľ aplikácie“: who can be added and what adding them would do (D-47). */
  userCandidates: authorizedProcedure('customer.read')
    .input(userCandidatesSchema)
    .query(({ ctx, input }) => persons.userCandidates(ctx.db, input.customerId)),

  addUser: authorizedProcedure('customer.write')
    .input(addUserContactSchema)
    .mutation(async ({ ctx, input }) => {
      const added = await run(() => persons.addUserContact(ctx.db, input));
      auditOrganization(ctx, input.customerId, {
        contact: 'linked',
        contactId: added.id,
        ...(input.isPrimary ? { primary: true } : {}),
      });
      return { id: added.id };
    }),

  disconnectUser: authorizedProcedure('customer.write')
    .input(personIdSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => persons.disconnectUser(ctx.db, input.id));
      ctx.audit.set({ entityType: 'person', entityId: input.id, diff: { userDisconnected: true } });
      return { ok: true as const };
    }),

  link: authorizedProcedure('customer.write')
    .input(linkPersonSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => persons.linkPerson(ctx.db, input.id, input));
      auditOrganization(ctx, input.customerId, {
        contact: 'linked',
        contactId: input.id,
        ...(input.isPrimary ? { primary: true } : {}),
      });
      return { ok: true as const };
    }),

  unlink: authorizedProcedure('customer.write')
    .input(unlinkPersonSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => persons.unlinkPerson(ctx.db, input.id, input.customerId));
      auditOrganization(ctx, input.customerId, { contact: 'unlinked', contactId: input.id });
      return { ok: true as const };
    }),

  delete: authorizedProcedure('customer.write')
    .input(personIdSchema)
    .mutation(async ({ ctx, input }) => {
      const gone = await run(() => persons.deletePerson(ctx.db, input.id));
      ctx.audit.set({
        entityType: 'person',
        entityId: input.id,
        diff: { deleted: true, count: gone.customerIds.length },
      });
      return { ok: true as const };
    }),
});
