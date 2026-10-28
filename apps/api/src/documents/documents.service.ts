import { COMPANY_ROOT_FOLDER_ID, fileExtension, SYSTEM_VARIABLES } from '@intra/shared/schemas';
import Docxtemplater, { type DXT } from 'docxtemplater';
import inspectModuleExport from 'docxtemplater/js/inspect-module.js';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import PizZip from 'pizzip';
import type { Db } from '../db/db.module.js';
import { contacts, files, fileVersions, folders } from '../db/schema/index.js';
import { valuesFor } from '../email/templates.service.js';
import { createFileFromBytes, customerRootFolderId } from '../files/files.service.js';
import type { Storage } from '../storage/storage.js';

/**
 * Document templates and generated documents (spec 7.4): a DOCX in the company folder
 * „Šablóny dokumentov“ with placeholders (`{customer.name}`, `{salutation}`, `{offer.price}`) is
 * a template; „Vytvoriť dokument“ fills it for a customer and saves the DOCX into the customer's
 * folder. The variables are the e-mail templates' ones; any other placeholder is a field to fill
 * in. No PDF (D-30).
 */

export const TEMPLATES_FOLDER_NAME = 'Šablóny dokumentov';

const SYSTEM = new Set<string>(SYSTEM_VARIABLES);

/**
 * The CommonJS module exports a factory (`module.exports = () => new InspectModule()`), while its
 * typings declare a class as default export.
 */
const newInspectModule = inspectModuleExport as unknown as () => DXT.Module & {
  getAllTags(): Record<string, unknown>;
};

/** A refusal the web words for itself (`sk.documents.errors`). */
export class DocumentError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'TEMPLATE_INVALID' | 'NOT_A_TEMPLATE') {
    super(code);
  }
}

/** A tag is looked up as written, dots included: `{customer.name}` is the key `customer.name`. */
const flatParser = (tag: string) => ({
  get: (scope: Record<string, unknown>) => (tag === '.' ? scope : scope[tag]),
});

/** The placeholders of a template, in the order of the document. */
export function templateTags(bytes: Uint8Array): string[] {
  const inspect = newInspectModule();
  try {
    new Docxtemplater(new PizZip(bytes), {
      modules: [inspect],
      parser: flatParser,
      paragraphLoop: true,
      linebreaks: true,
      // Its own log would carry the template's text; the refusal is ours to report.
      errorLogging: false,
    });
  } catch {
    throw new DocumentError('TEMPLATE_INVALID');
  }
  return Object.keys(inspect.getAllTags());
}

/** The template filled in: a missing value leaves its place empty. */
export function fillTemplate(bytes: Uint8Array, values: Record<string, string | undefined>) {
  try {
    const doc = new Docxtemplater(new PizZip(bytes), {
      parser: flatParser,
      paragraphLoop: true,
      linebreaks: true,
      // Its own log would carry the template's text; the refusal is ours to report.
      errorLogging: false,
      nullGetter: () => '',
    });
    doc.render(values);
    return doc.getZip().generate({ type: 'uint8array', compression: 'DEFLATE' });
  } catch {
    throw new DocumentError('TEMPLATE_INVALID');
  }
}

/** The company folder of the templates, made the first time it is needed. */
async function templatesFolderId(db: Db) {
  const where = and(
    eq(folders.parentId, COMPANY_ROOT_FOLDER_ID),
    // As the unique index compares names: without regard to case.
    sql`lower(${folders.name}) = lower(${TEMPLATES_FOLDER_NAME})`,
  );
  const [found] = await db.select({ id: folders.id }).from(folders).where(where);
  if (found) return found.id;
  await db
    .insert(folders)
    .values({ parentId: COMPANY_ROOT_FOLDER_ID, name: TEMPLATES_FOLDER_NAME })
    .onConflictDoNothing();
  const [made] = await db.select({ id: folders.id }).from(folders).where(where);
  return made!.id;
}

/** The current bytes of a live file, with its name. */
async function currentBytes(db: Db, storage: Storage, fileId: string) {
  const [row] = await db
    .select({ name: files.name, folderId: files.folderId, key: fileVersions.storageKey })
    .from(files)
    .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)));
  if (!row) throw new DocumentError('NOT_FOUND');
  return { ...row, bytes: await storage.read(row.key) };
}

/**
 * The templates: the DOCX files of „Šablóny dokumentov“, each with the fields to fill in (its
 * placeholders that are not variables). A broken one is listed as such.
 */
export async function listDocumentTemplates(db: Db, storage: Storage) {
  const folderId = await templatesFolderId(db);
  const rows = await db
    .select({ id: files.id, name: files.name, key: fileVersions.storageKey })
    .from(files)
    .innerJoin(fileVersions, eq(fileVersions.id, files.currentVersionId))
    .where(and(eq(files.folderId, folderId), isNull(files.deletedAt)))
    .orderBy(asc(sql`${files.name} collate "sk-x-icu"`));
  const templates = await Promise.all(
    rows
      .filter((row) => fileExtension(row.name) === 'docx')
      .map(async (row) => {
        try {
          const tags = templateTags(await storage.read(row.key));
          return {
            id: row.id,
            name: row.name,
            fields: tags.filter((tag) => !SYSTEM.has(tag)),
            valid: true,
          };
        } catch {
          return { id: row.id, name: row.name, fields: [] as string[], valid: false };
        }
      }),
  );
  return { folderId, templates };
}

/**
 * „Vytvoriť dokument“: the template filled for the customer (and one of its persons), the
 * colleague as sender and the fields typed, saved as a new DOCX in the customer's folder.
 */
export async function createDocument(
  db: Db,
  storage: Storage | null,
  userId: string,
  input: {
    templateId: string;
    customerId: string;
    contactId?: string | null | undefined;
    name: string;
    fields: Record<string, string>;
  },
) {
  if (!storage) throw new DocumentError('NOT_FOUND');
  const template = await currentBytes(db, storage, input.templateId);
  if (template.folderId !== (await templatesFolderId(db)))
    throw new DocumentError('NOT_A_TEMPLATE');
  if (input.contactId) {
    const [contact] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(
        and(
          eq(contacts.id, input.contactId),
          eq(contacts.customerId, input.customerId),
          isNull(contacts.deletedAt),
        ),
      );
    if (!contact) throw new DocumentError('NOT_FOUND');
  }
  const { values } = await valuesFor(
    db,
    input.contactId ? { contactId: input.contactId } : { customerId: input.customerId },
    userId,
    {},
  );
  // The fields as typed; a system variable keeps its own value.
  const filled = { ...input.fields, ...values };
  const bytes = fillTemplate(template.bytes, filled);
  const folderId = await customerRootFolderId(db, input.customerId);
  // „… s.r.o.“ + „.docx“ must not end in „s.r.o..docx“.
  const name = `${input.name.replace(/\.docx$/i, '').replace(/[.\s]+$/, '')}.docx`;
  const created = await createFileFromBytes(db, storage, {
    folderId,
    name,
    bytes,
    userId,
    via: 'generated',
    note: template.name,
  });
  return { ...created, name };
}
