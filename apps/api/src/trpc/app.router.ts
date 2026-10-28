import { accountRouter } from './account.router.js';
import { activityRouter } from './activity.router.js';
import { authRouter } from './auth.router.js';
import { codeListRouter } from './code-list.router.js';
import { customerRouter } from './customer.router.js';
import { documentRouter } from './document.router.js';
import { fileRouter } from './file.router.js';
import { inboundRouter } from './inbound.router.js';
import { notificationRouter } from './notification.router.js';
import { oauthRouter } from './oauth.router.js';
import { campaignRouter, unsubscribeRouter } from './campaign.router.js';
import { templateRouter } from './template.router.js';
import { router } from './trpc.js';
import { userRouter } from './user.router.js';

export const appRouter = router({
  auth: authRouter,
  account: accountRouter,
  user: userRouter,
  customer: customerRouter,
  codeList: codeListRouter,
  file: fileRouter,
  document: documentRouter,
  activity: activityRouter,
  template: templateRouter,
  campaign: campaignRouter,
  inbound: inboundRouter,
  notification: notificationRouter,
  oauth: oauthRouter,
  unsubscribe: unsubscribeRouter,
});

/** The web client's type: procedures, inputs and outputs, nothing of the server's internals. */
export type AppRouter = typeof appRouter;
