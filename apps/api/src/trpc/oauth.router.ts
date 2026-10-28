import {
  accessTokenIdSchema,
  oauthDecisionSchema,
  oauthRequestSchema,
} from '@intra/shared/schemas';
import { TRPCError } from '@trpc/server';
import { consentRequest, decideConsent, listConnections, revokeConnection } from '../mcp/oauth.js';
import { protectedProcedure, router } from './trpc.js';

/**
 * Claude's OAuth sign-in from the user's side: the consent page (which client asks, approve or
 * refuse) and „Pripojené aplikácie“ under „Môj účet“.
 */
export const oauthRouter = router({
  request: protectedProcedure.input(oauthRequestSchema).query(async ({ ctx, input }) => {
    const request = await consentRequest(ctx.db, input.request);
    if (!request) throw new TRPCError({ code: 'NOT_FOUND', message: 'REQUEST_EXPIRED' });
    return request;
  }),

  decide: protectedProcedure.input(oauthDecisionSchema).mutation(async ({ ctx, input }) => {
    const decided = await decideConsent(ctx.db, ctx.session.userId, input.request, input.approve);
    if (!decided) throw new TRPCError({ code: 'NOT_FOUND', message: 'REQUEST_EXPIRED' });
    ctx.audit.set({
      userId: ctx.session.userId,
      entityType: 'oauth',
      entityId: input.request,
      diff: { approved: decided.approved },
    });
    return { redirectTo: decided.redirectTo };
  }),

  connections: protectedProcedure.query(({ ctx }) => listConnections(ctx.db, ctx.session.userId)),

  revokeConnection: protectedProcedure
    .input(accessTokenIdSchema)
    .mutation(async ({ ctx, input }) => {
      const revoked = await revokeConnection(ctx.db, ctx.session.userId, input.id);
      if (!revoked) throw new TRPCError({ code: 'NOT_FOUND' });
      ctx.audit.set({
        userId: ctx.session.userId,
        entityType: 'oauth',
        entityId: input.id,
        diff: { revoked: true },
      });
      return { ok: true as const };
    }),
});
