/**
 * Company look-up by IČO in the Slovak register of legal persons (RPO) of the Statistical Office:
 * a public API without a key, data under CC BY 4.0. It knows the name and the seat; DIČ and
 * IČ DPH live with the Financial Administration and stay typed by hand.
 */

const RPO_SEARCH = 'https://api.statistics.sk/rpo/v1/search';
const TIMEOUT_MS = 8000;

/** What the form fills in from the register. */
export interface RegisterCompany {
  ico: string;
  name: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  /** The company has been struck off; the form says so instead of filling it in silently. */
  terminated: boolean;
}

/** The register did not answer (down, slow, changed): the form says to type the data by hand. */
export class RegisterUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('REGISTER_UNAVAILABLE', { cause });
  }
}

interface Valid {
  validFrom?: string;
  validTo?: string;
}
interface RpoEntity {
  identifiers?: (Valid & { value: string })[];
  fullNames?: (Valid & { value: string })[];
  addresses?: (Valid & {
    street?: string;
    regNumber?: number;
    buildingNumber?: string;
    postalCodes?: string[];
    municipality?: { value?: string };
  })[];
  terminationDate?: string;
}

/** The entry valid today: the one without an end, else the one that ended last. */
function current<T extends Valid>(items: T[] | undefined): T | undefined {
  if (!items?.length) return undefined;
  return (
    items.find((item) => !item.validTo) ??
    [...items].sort((a, b) => (b.validTo ?? '').localeCompare(a.validTo ?? ''))[0]
  );
}

/** „J. Jonáša 1“, „Hlavná 1234/5“; a village without streets: „Lúčky 120“. */
function streetLine(address: NonNullable<RpoEntity['addresses']>[number]) {
  const number = [address.regNumber || null, address.buildingNumber || null]
    .filter(Boolean)
    .join('/');
  const street = address.street?.trim();
  if (street) return [street, number].filter(Boolean).join(' ');
  // Without a street the number goes with the village; without either there is no line to write.
  return number ? `${address.municipality?.value?.trim() ?? ''} ${number}`.trim() : null;
}

/** „84302“ → „843 02“, the way a Slovak postal code is written. */
function postalCode(raw: string | undefined) {
  if (!raw) return null;
  const digits = raw.replace(/\s/g, '');
  return /^\d{5}$/.test(digits) ? `${digits.slice(0, 3)} ${digits.slice(3)}` : raw;
}

/**
 * The company registered under the IČO today, or null when there is none. An IČO a company held
 * once and gave up is not a match: the search finds it by its past identifiers too.
 */
export async function lookupCompany(
  ico: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RegisterCompany | null> {
  let body: { results?: RpoEntity[] };
  try {
    const res = await fetchImpl(`${RPO_SEARCH}?identifier=${encodeURIComponent(ico)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`RPO answered ${res.status}`);
    body = (await res.json()) as { results?: RpoEntity[] };
  } catch (error) {
    throw new RegisterUnavailableError(error);
  }
  const matches = (body.results ?? []).filter(
    (entity) => current(entity.identifiers)?.value === ico,
  );
  // A struck-off company and a new one may share the number over time: prefer the live one.
  const entity = matches.find((m) => !m.terminationDate) ?? matches[0];
  const name = current(entity?.fullNames)?.value?.trim();
  if (!entity || !name) return null;
  const address = current(entity.addresses);
  return {
    ico,
    name,
    street: address ? streetLine(address) : null,
    postalCode: postalCode(address?.postalCodes?.[0]),
    city: address?.municipality?.value?.trim() || null,
    terminated: Boolean(entity.terminationDate),
  };
}
