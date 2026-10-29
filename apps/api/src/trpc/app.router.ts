import { accountRouter } from './account.router.js';
import { activityRouter } from './activity.router.js';
import { auditRouter } from './audit.router.js';
import { authRouter } from './auth.router.js';
import { codeListRouter } from './code-list.router.js';
import { customerRouter } from './customer.router.js';
import { documentRouter } from './document.router.js';
import { fileRouter } from './file.router.js';
import { inboundRouter } from './inbound.router.js';
import { notificationRouter } from './notification.router.js';
import { oauthRouter } from './oauth.router.js';
import { overviewRouter } from './overview.router.js';
import { segmentRouter } from './segment.router.js';
import { campaignRouter, unsubscribeRouter } from './campaign.router.js';
import { personRouter } from './person.router.js';
import { templateRouter } from './template.router.js';
import { router } from './trpc.js';
import { userRouter } from './user.router.js';

export const appRouter = router({
  auth: authRouter,
  audit: auditRouter,
  account: accountRouter,
  user: userRouter,
  customer: customerRouter,
  person: personRouter,
  codeList: codeListRouter,
  file: fileRouter,
  document: documentRouter,
  activity: activityRouter,
  template: templateRouter,
  campaign: campaignRouter,
  inbound: inboundRouter,
  notification: notificationRouter,
  oauth: oauthRouter,
  overview: overviewRouter,
  segment: segmentRouter,
  unsubscribe: unsubscribeRouter,
});

/** The web client's type: procedures, inputs and outputs, nothing of the server's internals. */
export type AppRouter = typeof appRouter;
