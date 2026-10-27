import {
  bulkStatusSchema,
  bulkTagSchema,
  contactIdSchema,
  createContactSchema,
  createCustomerSchema,
  customerIdSchema,
  customerListSchema,
  exportCustomersSchema,
  updateContactSchema,
  updateCustomerSchema,
} from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import * as customers from '../customers/customers.service.js';
import { toCsv } from '../customers/csv.js';
import type { Context } from './context.js';
import { authorizedProcedure, router } from './trpc.js';

/** The service's refusals as tRPC errors, with the code as message for the web to word. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof customers.CustomerError)) throw error;
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
    .query(({ ctx, input }) => customers.listCustomers(ctx.db, input)),

  get: authorizedProcedure('customer.read')
    .input(customerIdSchema)
    .query(({ ctx, input }) => run(() => customers.getCustomer(ctx.db, input.id))),

  history: authorizedProcedure('customer.read')
    .input(customerIdSchema)
    .query(({ ctx, input }) => customers.customerHistory(ctx.db, input.id)),

  /** Types, sources, tags and colleagues for the forms and the filters. */
  options: authorizedProcedure('customer.read').query(({ ctx }) => customers.formOptions(ctx.db)),

  create: authorizedProcedure('customer.write')
    .input(createCustomerSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await run(() => customers.createCustomer(ctx.db, ctx.session.userId, input));
      auditCustomer(ctx, created.id, {
        kind: input.customer.kind,
        status: input.customer.status,
        firstContact: input.firstContact !== undefined,
      });
      return created;
    }),

  update: authorizedProcedure('customer.write')
    .input(updateCustomerSchema)
    .mutation(async ({ ctx, input }) => {
      const change = await run(() => customers.updateCustomer(ctx.db, input.id, input.customer));
      auditCustomer(ctx, input.id, {
        fields: change.fields.filter((f) => f !== 'status' && f !== 'ownerUserId'),
        ...(change.status.before !== change.status.after ? { status: change.status } : {}),
        ...(change.ownerUserId.before !== change.ownerUserId.after
          ? { ownerUserId: change.ownerUserId }
          : {}),
      });
      return { ok: true as const };
    }),

  delete: authorizedProcedure('customer.delete')
    .input(customerIdSchema)
    .mutation(async ({ ctx, input }) => {
      await run(() => customers.deleteCustomer(ctx.db, input.id));
      auditCustomer(ctx, input.id, { deleted: true });
      return { ok: true as const };
    }),

  bulkAddTag: authorizedProcedure('customer.write')
    .input(bulkTagSchema)
    .mutation(async ({ ctx, input }) => {
      const ids = await customers.bulkAddTag(ctx.db, input.ids, input.tag);
      ctx.audit.set({ entityType: 'customer', diff: { ids, count: ids.length, tagAdded: true } });
      return { count: ids.length };
    }),

  bulkSetStatus: authorizedProcedure('customer.write')
    .input(bulkStatusSchema)
    .mutation(async ({ ctx, input }) => {
      const ids = await customers.bulkSetStatus(ctx.db, input.ids, input.status);
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
      const rows = await customers.exportRows(ctx.db, input);
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

  contactCreate: authorizedProcedure('customer.write')
    .input(createContactSchema)
    .mutation(async ({ ctx, input }) => {
      const created = await run(() =>
        customers.createContact(ctx.db, input.customerId, input.contact),
      );
      auditCustomer(ctx, input.customerId, { contact: 'created', contactId: created.id });
      return created;
    }),

  contactUpdate: authorizedProcedure('customer.write')
    .input(updateContactSchema)
    .mutation(async ({ ctx, input }) => {
      const change = await run(() =>
        customers.updateContact(ctx.db, input.id, input.contact, input.receivesBulk),
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
      const { customerId } = await run(() => customers.setPrimaryContact(ctx.db, input.id));
      auditCustomer(ctx, customerId, { contact: 'primary', contactId: input.id });
      return { ok: true as const };
    }),

  contactDelete: authorizedProcedure('customer.write')
    .input(contactIdSchema)
    .mutation(async ({ ctx, input }) => {
      const { customerId } = await run(() => customers.deleteContact(ctx.db, input.id));
      auditCustomer(ctx, customerId, { contact: 'deleted', contactId: input.id });
      return { ok: true as const };
    }),
});
