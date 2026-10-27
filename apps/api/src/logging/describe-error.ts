/**
 * Error names down the cause chain and the Postgres error code, nothing else. The message of a
 * failed query holds the SQL with its parameters, and parameters are health data (CLAUDE.md rule 6).
 */
export function describeError(error: unknown) {
  const names: string[] = [];
  let pgCode: string | undefined;
  for (let e = error; e instanceof Error && names.length < 5; e = e.cause) {
    names.push(e.name);
    if ('code' in e && typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) pgCode = e.code;
  }
  return { names, pgCode };
}
