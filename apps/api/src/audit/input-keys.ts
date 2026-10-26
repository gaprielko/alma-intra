/**
 * The field names each procedure's input schema declares, by procedure path. The audit
 * interceptor runs before the input is parsed and only sees the raw input, whose keys are
 * caller-chosen text; the default diff (`fieldsOf`) keeps only the names registered here.
 * Filled once per router, when the tRPC module (or a test) mounts it. A path that was never
 * registered gets an empty field list.
 */
const inputKeys = new Map<string, ReadonlySet<string>>();
const NONE: ReadonlySet<string> = new Set();

interface SchemaLike {
  shape?: Record<string, unknown>;
  _def?: { schema?: SchemaLike; innerType?: SchemaLike };
}

/** Keys of a Zod object, looking through refinements, transforms, defaults and optionals. */
function shapeKeys(schema: SchemaLike | undefined, depth = 0): string[] {
  if (!schema || depth > 5) return [];
  if (schema.shape && typeof schema.shape === 'object') return Object.keys(schema.shape);
  return shapeKeys(schema._def?.schema ?? schema._def?.innerType, depth + 1);
}

export function registerInputKeys(router: { _def: { procedures: unknown } }) {
  const procedures = router._def.procedures as Record<string, { _def: { inputs?: SchemaLike[] } }>;
  for (const [path, procedure] of Object.entries(procedures)) {
    inputKeys.set(path, new Set((procedure._def.inputs ?? []).flatMap((s) => shapeKeys(s))));
  }
}

export const inputKeysOf = (path: string): ReadonlySet<string> => inputKeys.get(path) ?? NONE;
