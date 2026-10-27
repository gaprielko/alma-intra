import argon2 from 'argon2';
import { sql } from 'drizzle-orm';
import { encryptField } from '../crypto/field-encryption.js';
import type { Db } from './db.module.js';
import { seedCustomers } from './seed-customers.js';
import { userSecondFactors, users } from './schema/index.js';

/** The password of every seeded active user. Public on purpose: the seed refuses production. */
export const SEED_PASSWORD = 'Alma-intra-2026';
/**
 * The second factor of every seeded active user (base32). Any authenticator app, or `totpAt` in
 * the tests, makes their codes from it.
 */
export const SEED_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Fixed ids, so the seed can run again and tests can name the people. */
export const SEED_USERS = {
  jana: id(1),
  peter: id(2),
  lucia: id(3),
  martin: id(4),
  tomas: id(5),
} as const;

/**
 * Development and test data: three active colleagues with a password and a second factor, one
 * invitation not accepted yet and one deactivated account, and ten customers with their contacts
 * (`seed-customers.ts`). Idempotent: rows are upserted by id.
 */
export async function seed(db: Db, encryptionKey: string) {
  const passwordHash = await argon2.hash(SEED_PASSWORD);
  const people = [
    {
      id: SEED_USERS.jana,
      email: 'jana.horvathova@example.com',
      name: 'Jana Horváthová',
      position: 'Konateľka',
      status: 'active',
    },
    {
      id: SEED_USERS.peter,
      email: 'peter.kovac@example.com',
      name: 'Peter Kováč',
      position: 'Obchodný manažér',
      status: 'active',
    },
    {
      id: SEED_USERS.lucia,
      email: 'lucia.bartosova@example.com',
      name: 'Lucia Bartošová',
      position: 'Marketing',
      status: 'active',
    },
    {
      id: SEED_USERS.martin,
      email: 'martin.simko@example.com',
      name: 'Martin Šimko',
      position: 'Podpora zákazníkov',
      status: 'invited',
    },
    {
      id: SEED_USERS.tomas,
      email: 'tomas.hudec@example.com',
      name: 'Tomáš Hudec',
      position: 'Obchod',
      status: 'deactivated',
    },
  ] as const;

  await db.transaction(async (tx) => {
    for (const person of people) {
      const hadPassword = person.status !== 'invited';
      const values = {
        ...person,
        phone: null,
        passwordHash: hadPassword ? passwordHash : null,
        invitedByUserId: person.id === SEED_USERS.jana ? null : SEED_USERS.jana,
        activatedAt: hadPassword ? sql`now()` : null,
        deactivatedAt: person.status === 'deactivated' ? sql`now()` : null,
      };
      await tx
        .insert(users)
        .values(values)
        .onConflictDoUpdate({ target: users.id, set: { ...values, updatedAt: sql`now()` } });
      if (!hadPassword) continue;
      const secret = encryptField(SEED_TOTP_SECRET, encryptionKey, {
        table: 'user_second_factors',
        column: 'secret_encrypted',
        rowId: person.id,
      });
      await tx
        .insert(userSecondFactors)
        .values({ userId: person.id, secretEncrypted: secret, confirmedAt: sql`now()` })
        .onConflictDoUpdate({
          target: userSecondFactors.userId,
          set: { secretEncrypted: secret, confirmedAt: sql`now()`, lastUsedStep: null },
        });
    }
    await seedCustomers(tx, SEED_USERS);
  });
}
