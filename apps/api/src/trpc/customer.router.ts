import {
  bulkStatusSchema,
  bulkTagSchema,
  contactIdSchema,
  createContactSchema,
  createCustomerSchema,
  customerIdSchema,
  customerListSchema,
  exportCustomersSchema,
  icoLookupSchema,
  setRoleSchema,
  updateContactSchema,
  updateCustomerSchema,
} from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import { lookupCompany, RegisterUnavailableError } from '../customers/business-register.js';
import * as organizations from '../customers/customers.service.js';
import { toCsv } from '../customers/csv.js';
import type { Context } from './context.js';
import { authorizedProcedure, router } from './trpc.js';

/** The service's refusals as tRPC errors, with the code as message for the web to word. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof organizations.CustomerError)) throw error;
    const code =
      error.code === 'NOT_FOUND'
        ? 'NOT_FOUND'
        : error.code === 'ICO_TAKEN' || error.code === 'CONTACT_EMAIL_TAKEN'
          ? 'CONFLICT'
          : 'BAD_REQUEST';
    throw new TRPCError({ code, message: error.code });
  }
}

/** Every event of a customer and its contacts is the customer's: its history reads them back. */
const auditCustomer = (ctx: Context, id: string, diff?: Record<string, unknown>) =>
  ctx.audit.set({ entityType: 'customer', entityId: id, ...(diff ? { diff } : {}) });

/**
 * Zákazníci: the list with its filters, the detail, the forms, the contacts of an organization,
 * the bulk actions and the CSV export.
 */
export const customerRouter = router({
  list: authorizedProcedure('customer.read')
    .input(customerListSchema)
    .query(({ ctx, input }) => organizations.listCustomers(ctx.db, input)),

  get: authorizedProcedure('customer.read')
    .input(customerIdSchema)
    .query(({ ctx, input }) => run(() => organizations.getCustomer(ctx.db, input.id))),

  history: authorizedProcedure('customer.read')
    .input(customerIdSchema)
    .query(({ ctx, input }) => organizations.customerHistory(ctx.db, input.id)),

  /** Types, sources, tags and colleagues for the forms and the filters. */
  options: authorizedProcedure('customer.read').query(({ ctx }) =>
    organizations.formOptions(ctx.db),
  ),

  /** The name and seat of a company from the business register, to fill the form with. */
  lookupIco: authorizedProcedure('customer.write')
    .input(icoLookupSchema)
    .query(async ({ input }) => {
      try {
        return await lookupCompany(input.ico);
      } catch (error) {
        if (!(error instanceof RegisterUnavailableError)) throw error;
        throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: error.message });
      }
    }),

  create: authorizedProcedure('customer.write')
    .input(createCustomerSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await run(() =>
        organizations.createCustomer(ctx.db, ctx.session.userId, input),
      );
      auditCustomer(ctx, created.id, {
        kind: input.customer.kind,
        // As stored: a partner has none.
        ...(created.status ? { status: created.status } : {}),
        role: input.customer.role,
        firstContact: input.firstContact !== undefined,
        ...(created.tagsAdded.length > 0 ? { tagsAdded: created.tagsAdded } : {}),
        ...(created.productsAdded.length > 0 ? { productsAdded: created.productsAdded } : {}),
      });
      return created;
    }),

  update: authorizedProcedure('customer.write')
    .input(updateCustomerSchema)
    .mutation(async ({ ctx, input }) => {
      const change = await run(() =>
        organizations.updateCustomer(ctx.db, input.id, input.customer),
      );
      auditCustomer(ctx, input.id, {
        fields: change.fields.filter((f) => f !== 'status' && f !== 'ownerUserId'),
        ...(change.status.before !== change.status.after ? { status: change.status } : {}),
        ...(change.ownerUserId.before !== change.ownerUserId.after
          ? { ownerUserId: change.ownerUserId }
          : {}),
        // Ids only: the history resolves the names when it is shown (names never go into the
        // append-only trail).
        ...(change.role.before !== change.role.after ? { role: change.role.after } : {}),
        ...(change.sourceId.before !== change.sourceId.after ? { sourceId: change.sourceId } : {}),
        ...(change.tagsAdded.length > 0 ? { tagsAdded: change.tagsAdded } : {}),
        ...(change.tagsRemoved.length > 0 ? { tagsRemoved: change.tagsRemoved } : {}),
        ...(change.productsAdded.length > 0 ? { productsAdded: change.productsAdded } : {}),
        ...(change.productsRemoved.length > 0 ? { productsRemoved: change.productsRemoved } : {}),
      });
      return { ok: true as const };
    }),

  delete: authorizedProcedure('customer.delete')
    .input(customerIdSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => organizations.deleteCustomer(ctx.db, input.id));
      auditCustomer(ctx, input.id, { deleted: true });
      return { ok: true as const };
    }),

  bulkAddTag: authorizedProcedure('customer.write')
    .input(bulkTagSchema)
    .mutation(async ({ ctx, input }) => {
      const { ids, tagId } = await organizations.bulkAddTag(ctx.db, input.ids, input.tag);
      ctx.audit.set({
        entityType: 'customer',
        diff: { ids, count: ids.length, tagAdded: true, tagId },
      });
      return { count: ids.length };
    }),

  bulkSetStatus: authorizedProcedure('customer.write')
    .input(bulkStatusSchema)
    .mutation(async ({ ctx, input }) => {
      const ids = await organizations.bulkSetStatus(ctx.db, input.ids, input.status);
      ctx.audit.set({
        entityType: 'customer',
        diff: { ids, count: ids.length, status: { after: input.status } },
      });
      return { count: ids.length };
    }),

  /**
   * A mutation, not a query: an export of personal data leaves a trace in the audit trail (how
   * many rows and which filters, never the rows).
   */
  exportCsv: authorizedProcedure('customer.export')
    .input(exportCustomersSchema)
    .mutation(async ({ ctx, input }) => {
      const rows = await organizations.exportRows(ctx.db, input);
      ctx.audit.set({
        entityType: 'customer',
        diff: {
          exported: true,
          resultCount: rows.length,
          filters: Object.keys(input).filter(
            (key) => key !== 'ids' && input[key as keyof typeof input] !== undefined,
          ),
          selected: input.ids !== undefined,
        },
      });
      return { csv: toCsv(rows), count: rows.length };
    }),

  /** „Zmeniť na zákazníka“ / „Zmeniť na partnera“ (D-5). */
  setRole: authorizedProcedure('customer.write')
    .input(setRoleSchema)
    .mutation(async ({ ctx, input }) => {
      const change = await run(() => organizations.setRole(ctx.db, input.id, input.role));
      if (change.changed) {
        auditCustomer(ctx, input.id, {
          role: input.role,
          ...(change.productsRemoved.length > 0 ? { productsRemoved: change.productsRemoved } : {}),
        });
      }
      return { ok: true as const };
    }),

  contactCreate: authorizedProcedure('customer.write')
    .input(createContactSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await run(() =>
        organizations.createContact(ctx.db, input.customerId, input.contact),
      );
      auditCustomer(ctx, input.customerId, { contact: 'created', contactId: created.id });
      return created;
    }),

  contactUpdate: authorizedProcedure('customer.write')
    .input(updateContactSchema)
    .mutation(async ({ ctx, input }) => {
      const change = await run(() =>
        organizations.updateContact(
          ctx.db,
          input.id,
          input.customerId,
          input.contact,
          input.receivesBulk,
        ),
      );
      auditCustomer(ctx, change.customerId, {
        contact: 'updated',
        contactId: input.id,
        fields: change.fields,
      });
      return { ok: true as const };
    }),

  contactSetPrimary: authorizedProcedure('customer.write')
    .input(contactIdSchema)
    .mutation(async ({ ctx, input }) => {
      const { customerId } = await run(() =>
        organizations.setPrimaryContact(ctx.db, input.id, input.customerId),
      );
      auditCustomer(ctx, customerId, { contact: 'primary', contactId: input.id });
      return { ok: true as const };
    }),

  contactDelete: authorizedProcedure('customer.write')
    .input(contactIdSchema)
    .mutation(async ({ ctx, input }) => {
      const { customerId } = await run(() =>
        organizations.deleteContact(ctx.db, input.id, input.customerId),
      );
      auditCustomer(ctx, customerId, { contact: 'deleted', contactId: input.id });
      return { ok: true as const };
    }),
});
