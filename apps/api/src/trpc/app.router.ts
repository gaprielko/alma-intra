import { accountRouter } from './account.router.js';
import { authRouter } from './auth.router.js';
import { codeListRouter } from './code-list.router.js';
import { customerRouter } from './customer.router.js';
import { router } from './trpc.js';
import { userRouter } from './user.router.js';

export const appRouter = router({
  auth: authRouter,
  account: accountRouter,
  user: userRouter,
  customer: customerRouter,
  codeList: codeListRouter,
});

/** The web client's type: procedures, inputs and outputs, nothing of the server's internals. */
export type AppRouter = typeof appRouter;
