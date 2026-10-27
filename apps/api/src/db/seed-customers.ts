import { eq, sql } from 'drizzle-orm';
import type { Tx } from './db.module.js';
import { COMPANY_ROOT_FOLDER_ID } from '@intra/shared/schemas';
import {
  contacts,
  contactTypes,
  customers,
  customerSources,
  customerTags,
  folders,
  tags,
} from './schema/index.js';

/** The type `0003_customer_type_ados` installs. */
export const ADOS_TYPE_ID = '00000000-0000-4000-8000-0000000000a1';

const id = (prefix: string, n: number) =>
  `00000000-0000-4000-8000-${prefix}${String(n).padStart(12 - prefix.length, '0')}`;

const SOURCES = ['Odporúčanie', 'Konferencia', 'Web', 'Iné'];
const TAGS = ['pilot 2026', 'konferencia Košice', 'web', '18 sestier'];

type Person = {
  titleBefore?: string;
  firstName: string;
  lastName: string;
  gender: 'male' | 'female';
  salutation: string;
  position?: string;
  email: string;
  phone?: string;
  unsubscribed?: boolean;
};

interface SeedCustomer {
  name: string;
  kind: 'organization' | 'individual';
  ados: boolean;
  status: (typeof customers.$inferInsert)['status'];
  city: string;
  region: (typeof customers.$inferInsert)['region'];
  owner: string;
  source?: number;
  tags?: number[];
  ico?: string;
  street?: string;
  postalCode?: string;
  web?: string;
  email?: string;
  phone?: string;
  note?: string;
  people: Person[];
}

/** Development customers, as on the designs. Upserted by fixed ids, like the users. */
export async function seedCustomers(
  tx: Tx,
  owners: { jana: string; peter: string; lucia: string },
) {
  for (const [i, name] of SOURCES.entries()) {
    await tx
      .insert(customerSources)
      .values({ id: id('b', i + 1), name, position: i + 1 })
      .onConflictDoNothing();
  }
  for (const [i, name] of TAGS.entries()) {
    await tx
      .insert(tags)
      .values({ id: id('c', i + 1), name })
      .onConflictDoNothing();
  }

  const list: SeedCustomer[] = [
    {
      name: 'ADOS Harmónia, s.r.o.',
      kind: 'organization',
      ados: true,
      status: 'customer',
      city: 'Košice',
      region: 'kosice',
      owner: owners.peter,
      source: 0,
      tags: [0, 3],
      ico: '51234567',
      street: 'Hlavná 112',
      postalCode: '040 01',
      web: 'adosharmonia.sk',
      email: 'info@adosharmonia.sk',
      phone: '+421 55 622 1100',
      note: 'Pilot od apríla 2026. Fakturácia štvrťročne.',
      people: [
        {
          titleBefore: 'Mgr.',
          firstName: 'Eva',
          lastName: 'Tóthová',
          gender: 'female',
          salutation: 'Vážená pani riaditeľka',
          position: 'Riaditeľka',
          email: 'eva.tothova@adosharmonia.sk',
          phone: '+421 905 222 314',
        },
        {
          titleBefore: 'Bc.',
          firstName: 'Marek',
          lastName: 'Lukáč',
          gender: 'male',
          salutation: 'Vážený pán Lukáč',
          position: 'Ekonóm',
          email: 'ekonom@adosharmonia.sk',
          phone: '+421 908 771 020',
        },
        {
          firstName: 'Jana',
          lastName: 'Pavlíková',
          gender: 'female',
          salutation: 'Vážená pani vedúca sestra',
          position: 'Vedúca sestra',
          email: 'pavlikova@adosharmonia.sk',
          phone: '+421 917 404 118',
          unsubscribed: true,
        },
      ],
    },
    {
      name: 'Domáca ošetrovateľská starostlivosť Lipa',
      kind: 'organization',
      ados: true,
      status: 'interested',
      city: 'Prešov',
      region: 'presov',
      owner: owners.jana,
      source: 1,
      tags: [1],
      people: [
        {
          titleBefore: 'Bc.',
          firstName: 'Zuzana',
          lastName: 'Mikulová',
          gender: 'female',
          salutation: 'Vážená pani Mikulová',
          email: 'mikulova@adoslipa.sk',
        },
      ],
    },
    {
      name: 'ADOS Svätá Alžbeta, n.o.',
      kind: 'organization',
      ados: true,
      status: 'contacted',
      city: 'Bratislava',
      region: 'bratislava',
      owner: owners.peter,
      people: [
        {
          titleBefore: 'PhDr.',
          firstName: 'Katarína',
          lastName: 'Nováková',
          gender: 'female',
          salutation: 'Vážená pani riaditeľka',
          position: 'Riaditeľka',
          email: 'riaditelka@ados-alzbeta.sk',
        },
      ],
    },
    {
      name: 'Mária Kováčová',
      kind: 'individual',
      ados: false,
      status: 'lead',
      city: 'Trnava',
      region: 'trnava',
      owner: owners.lucia,
      source: 2,
      tags: [2],
      street: 'Hlavná 18',
      postalCode: '917 01',
      email: 'maria.kovacova@gmail.com',
      phone: '+421 944 515 207',
      people: [
        {
          firstName: 'Mária',
          lastName: 'Kováčová',
          gender: 'female',
          salutation: 'Vážená pani Kováčová',
          email: 'maria.kovacova@gmail.com',
        },
      ],
    },
    {
      name: 'Opatrovateľská služba Nádej',
      kind: 'organization',
      ados: false,
      status: 'contacted',
      city: 'Nitra',
      region: 'nitra',
      owner: owners.jana,
      people: [
        {
          titleBefore: 'Ing.',
          firstName: 'Róbert',
          lastName: 'Baláž',
          gender: 'male',
          salutation: 'Vážený pán Baláž',
          email: 'balaz@nadej-nitra.sk',
        },
      ],
    },
    {
      name: 'ADOS Medicare Žilina, s.r.o.',
      kind: 'organization',
      ados: true,
      status: 'customer',
      city: 'Žilina',
      region: 'zilina',
      owner: owners.peter,
      tags: [0],
      people: [
        {
          titleBefore: 'Mgr.',
          firstName: 'Ivana',
          lastName: 'Kubíková',
          gender: 'female',
          salutation: 'Vážená pani magisterka',
          email: 'kubikova@medicare-za.sk',
        },
      ],
    },
    {
      name: 'ADOS Pri Dunaji',
      kind: 'organization',
      ados: true,
      status: 'lead',
      city: 'Komárno',
      region: 'nitra',
      owner: owners.lucia,
      tags: [1],
      people: [
        {
          firstName: 'Erika',
          lastName: 'Szabóová',
          gender: 'female',
          salutation: 'Vážená pani Szabóová',
          email: 'info@adosdunaj.sk',
        },
      ],
    },
    {
      name: 'Agentúra Zdravie Plus, s.r.o.',
      kind: 'organization',
      ados: true,
      status: 'not_interested',
      city: 'Trnava',
      region: 'trnava',
      owner: owners.peter,
      people: [
        {
          titleBefore: 'Mgr.',
          firstName: 'Jozef',
          lastName: 'Hruška',
          gender: 'male',
          salutation: 'Vážený pán Hruška',
          email: 'hruska@zdravieplus.sk',
        },
      ],
    },
    {
      name: 'ADOS Slnečnica',
      kind: 'organization',
      ados: true,
      status: 'former_customer',
      city: 'Banská Bystrica',
      region: 'banska_bystrica',
      owner: owners.jana,
      people: [
        {
          titleBefore: 'Mgr.',
          firstName: 'Alena',
          lastName: 'Vargová',
          gender: 'female',
          salutation: 'Vážená pani Vargová',
          email: 'vargova@slnecnica-bb.sk',
        },
      ],
    },
    {
      name: 'ADOS Večernica',
      kind: 'organization',
      ados: true,
      status: 'lead',
      city: 'Martin',
      region: 'zilina',
      owner: owners.lucia,
      tags: [2],
      people: [],
    },
  ];

  // „Zákazník“, installed by `0011_contact_types`.
  const [customerType] = await tx
    .select({ id: contactTypes.id })
    .from(contactTypes)
    .where(eq(contactTypes.systemKey, 'customer'));
  for (const [i, c] of list.entries()) {
    const customerId = id('d', i + 1);
    const self = c.kind === 'individual' ? c.people[0]! : undefined;
    const values: typeof customers.$inferInsert = {
      id: customerId,
      kind: c.kind,
      contactTypeId: customerType!.id,
      typeId: c.ados ? ADOS_TYPE_ID : null,
      name: c.name,
      ico: c.ico ?? null,
      status: c.status,
      street: c.street ?? null,
      postalCode: c.postalCode ?? null,
      city: c.city,
      region: c.region,
      web: c.web ?? null,
      email: c.email ?? null,
      phone: c.phone ?? null,
      ownerUserId: c.owner,
      sourceId: c.source === undefined ? null : id('b', c.source + 1),
      note: c.note ?? null,
      firstName: self?.firstName ?? null,
      lastName: self?.lastName ?? null,
      gender: self?.gender ?? null,
      salutation: self?.salutation ?? null,
      createdByUserId: owners.jana,
      deletedAt: null,
    };
    await tx
      .insert(customers)
      .values(values)
      .onConflictDoUpdate({ target: customers.id, set: { ...values, updatedAt: sql`now()` } });
    await tx.insert(folders).values({ customerId }).onConflictDoNothing();
    await tx.delete(customerTags).where(sql`${customerTags.customerId} = ${customerId}`);
    for (const tag of c.tags ?? []) {
      await tx.insert(customerTags).values({ customerId, tagId: id('c', tag + 1) });
    }
    if (c.kind !== 'organization') continue;
    for (const [j, p] of c.people.entries()) {
      const contact: typeof contacts.$inferInsert = {
        id: id('e', (i + 1) * 10 + j),
        customerId,
        titleBefore: p.titleBefore ?? null,
        firstName: p.firstName,
        lastName: p.lastName,
        gender: p.gender,
        salutation: p.salutation,
        position: p.position ?? null,
        email: p.email,
        phone: p.phone ?? null,
        isPrimary: j === 0,
        unsubscribedAt: p.unsubscribed ? new Date('2026-09-03T08:00:00Z') : null,
        unsubscribeSource: p.unsubscribed ? 'link' : null,
        deletedAt: null,
      };
      await tx
        .insert(contacts)
        .values(contact)
        .onConflictDoUpdate({ target: contacts.id, set: { ...contact, updatedAt: sql`now()` } });
    }
  }
}

/** The company's folders of the designs, under „Firemné dokumenty“ (installed by a migration). */
export async function seedFolders(tx: Tx, createdBy: string) {
  const top = ['Zmluvy', 'Cenníky', 'Marketing', 'Šablóny dokumentov', 'Interné'];
  for (const [i, name] of top.entries()) {
    await tx
      .insert(folders)
      .values({
        id: id('f', i + 1),
        parentId: COMPANY_ROOT_FOLDER_ID,
        name,
        createdByUserId: createdBy,
      })
      .onConflictDoNothing();
  }
  await tx
    .insert(folders)
    .values({
      id: id('f', 10),
      parentId: id('f', 3),
      name: 'Prezentácie',
      createdByUserId: createdBy,
    })
    .onConflictDoNothing();
}
