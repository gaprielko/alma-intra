import { randomBytes } from 'node:crypto';
import { decryptField, encryptField, keyIdOf } from './field-encryption.js';

const key = randomBytes(32).toString('base64');

const at = {
  table: 'user_second_factors',
  column: 'secret_encrypted',
  rowId: '00000000-0000-4000-8000-000000000501',
};

describe('field encryption', () => {
  it('round-trips and never produces the same ciphertext twice', () => {
    const a = encryptField('JBSWY3DPEHPK3PXP', key, at);
    const b = encryptField('JBSWY3DPEHPK3PXP', key, at);
    expect(a).not.toBe(b);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptField(a, key, at)).toBe('JBSWY3DPEHPK3PXP');
    expect(decryptField(b, key, at)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('names the key it was written with', () => {
    const value = encryptField('secret', key, at);
    expect(value.split('.')[0]).toBe('v1');
    expect(value.split('.')[1]).toBe(keyIdOf(key));
  });

  it('rejects a wrong key, a tampered value and a bad key length', () => {
    const value = encryptField('secret', key, at);
    expect(() => decryptField(value, randomBytes(32).toString('base64'), at)).toThrow();
    const parts = value.split('.');
    const tampered = [...parts.slice(0, 4), Buffer.from('other').toString('base64url')].join('.');
    expect(() => decryptField(tampered, key, at)).toThrow();
    expect(() => encryptField('secret', randomBytes(16).toString('base64'), at)).toThrow();
  });

  it('a ciphertext moved to another row, column or table does not decrypt', () => {
    const value = encryptField('secret', key, at);
    const otherRow = { ...at, rowId: '00000000-0000-4000-8000-000000000502' };
    expect(() => decryptField(value, key, otherRow)).toThrow();
    expect(() => decryptField(value, key, { ...at, column: 'pending_secret' })).toThrow();
    expect(() => decryptField(value, key, { ...at, table: 'users' })).toThrow();
  });

  it('refuses a location whose parts could be ambiguous', () => {
    expect(() => encryptField('secret', key, { ...at, rowId: 'not-a-uuid' })).toThrow();
    expect(() => encryptField('secret', key, { ...at, table: 'users|x' })).toThrow();
  });
});
