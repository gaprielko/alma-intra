import { overviewSummary } from '../overview/overview.service.js';
import { authorizedProcedure, router } from './trpc.js';

/** Prehľad: the dashboard's numbers in one call. */
export const overviewRouter = router({
  summary: authorizedProcedure('customer.read').query(({ ctx }) =>
    overviewSummary(ctx.db, ctx.session.userId),
  ),
});
