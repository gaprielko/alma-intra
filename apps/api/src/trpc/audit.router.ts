import { auditListSchema } from '@intra/shared/schemas';
import { listAuditEvents } from '../audit/audit-log.service.js';
import { authorizedProcedure, router } from './trpc.js';

/** Nastavenia › Záznam aktivít: the audit trail, read (D-16). */
export const auditRouter = router({
  list: authorizedProcedure('audit.read')
    .input(auditListSchema)
    .query(({ ctx, input }) => listAuditEvents(ctx.db, input)),
});
