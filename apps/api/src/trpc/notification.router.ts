import { markNotificationsSchema } from '@intra/shared/schemas';
import * as notifications from '../notifications/notifications.service.js';
import { authorizedProcedure, router } from './trpc.js';

/** The bell: one's own notifications (replies, bounces) and marking them read. */
export const notificationRouter = router({
  list: authorizedProcedure('email.read').query(({ ctx }) =>
    notifications.listNotifications(ctx.db, ctx.session.userId),
  ),

  markRead: authorizedProcedure('email.read')
    .input(markNotificationsSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await notifications.markRead(ctx.db, ctx.session.userId, input.ids);
      ctx.audit.set({ entityType: 'notification', diff: { count: result.count } });
      return result;
    }),
});
