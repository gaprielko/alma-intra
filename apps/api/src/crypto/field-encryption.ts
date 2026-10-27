import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const FIELD_VERSION = 'v1';

function keyFrom(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded');
  return key;
}

/**
 * Where an encrypted value lives. It is authenticated with the value (GCM additional data), so a
 * ciphertext copied to another row or column no longer decrypts. Row ids are generated before
 * the insert, so the row is always known.
 */
export interface FieldLocation {
  table: string;
  column: string;
  rowId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SQL_NAME = /^[a-z][a-z0-9_]*$/;

/** Every part has a fixed alphabet without `|`, so two locations can never spell the same bytes. */
function aadOf(at: FieldLocation): Buffer {
  if (!UUID.test(at.rowId)) {
    throw new Error('Encrypted field location: the row id must be a UUID');
  }
  if (!SQL_NAME.test(at.table) || !SQL_NAME.test(at.column)) {
    throw new Error('Encrypted field location: table and column must be SQL names');
  }
  return Buffer.from(
    ['intra:field', FIELD_VERSION, at.table, at.column, at.rowId].join('|').toLowerCase(),
    'utf8',
  );
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Names the key a value was encrypted with. A fingerprint rather than a configured name: nothing
 * to keep in sync with the environment, and a value under another key is reported as such
 * instead of as a failed tag. Derived through HKDF, so it says nothing about the key itself.
 * It does not rotate anything by itself: `decryptField` takes one key, and a rotation is a
 * re-encryption pass that the key id makes possible to do (and to verify) value by value.
 */
export function keyIdOf(base64Key: string): string {
  return Buffer.from(
    hkdfSync('sha256', keyFrom(base64Key), Buffer.alloc(0), 'intra:key-id:v1', 4),
  ).toString('hex');
}

/**
 * AES-256-GCM with a random IV per value, bound to its location.
 * Output: `v1.<key id>.<iv>.<tag>.<ciphertext>` (base64url).
 */
export function encryptField(plain: string, base64Key: string, at: FieldLocation): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(base64Key), iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(aadOf(at));
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [FIELD_VERSION, keyIdOf(base64Key), iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

export function decryptField(value: string, base64Key: string, at: FieldLocation): string {
  const parts = value.split('.');
  const [version, keyId, ivPart, tagPart, ciphertext] = parts;
  if (version !== FIELD_VERSION || parts.length !== 5 || !keyId || !ivPart || !tagPart)
    throw new Error('Unknown encrypted field format');
  if (keyId !== keyIdOf(base64Key)) throw new Error('Encrypted field was written with another key');
  const iv = Buffer.from(ivPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  // Node accepts GCM tags of 4, 8 or 12 bytes unless told otherwise; a short tag is a forgeable one.
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Unknown encrypted field format');
  }
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(base64Key), iv, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(aadOf(at));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext ?? '', 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
