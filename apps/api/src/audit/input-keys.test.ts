import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import { inputKeysOf, registerInputKeys } from './input-keys.js';

const t = initTRPC.create();

describe('input keys registry', () => {
  it('knows the declared keys of every procedure, through refinements, defaults and merges', () => {
    const router = t.router({
      plain: t.procedure.input(z.object({ id: z.string(), note: z.string() })).query(() => 1),
      refined: t.procedure
        .input(
          z
            .object({ from: z.string(), to: z.string() })
            .refine((v) => v.from !== v.to)
            .transform((v) => v),
        )
        .mutation(() => 1),
      optional: t.procedure.input(z.object({ page: z.number() }).optional()).query(() => 1),
      chained: t.procedure
        .input(z.object({ a: z.string() }))
        .input(z.object({ b: z.string() }))
        .query(() => 1),
      passthrough: t.procedure.input(z.object({ id: z.string() }).passthrough()).query(() => 1),
      none: t.procedure.query(() => 1),
      nested: t.router({ inner: t.procedure.input(z.object({ x: z.string() })).query(() => 1) }),
    });
    registerInputKeys(router);

    expect([...inputKeysOf('plain')].sort()).toEqual(['id', 'note']);
    expect([...inputKeysOf('refined')].sort()).toEqual(['from', 'to']);
    expect([...inputKeysOf('optional')]).toEqual(['page']);
    expect([...inputKeysOf('chained')].sort()).toEqual(['a', 'b']);
    expect([...inputKeysOf('passthrough')]).toEqual(['id']);
    expect([...inputKeysOf('none')]).toEqual([]);
    expect([...inputKeysOf('nested.inner')]).toEqual(['x']);
  });

  it('an unknown path has no keys', () => {
    expect([...inputKeysOf('never.registered')]).toEqual([]);
  });
});
