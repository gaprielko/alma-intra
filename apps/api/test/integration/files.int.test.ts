import { COMPANY_ROOT_FOLDER_ID } from '@intra/shared/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storageKey } from '../../src/storage/storage.js';
import { browser, JANA, startApi } from './client.js';
import { memoryStorage } from './memory-storage.js';

const text = (value: string) => new TextEncoder().encode(value);
const PDF = text('%PDF-1.4\n%%EOF\n');

describe('files', () => {
  const bucket = memoryStorage();
  let api: Awaited<ReturnType<typeof startApi>>;
  let jana: ReturnType<typeof browser>;
  let folderId: string;

  beforeAll(async () => {
    api = await startApi({ storage: bucket.storage });
    jana = browser(api.baseUrl);
    await jana.signIn(JANA);
    const made = await jana.call<{ id: string }>('file.createFolder', {
      parentId: COMPANY_ROOT_FOLDER_ID,
      name: 'Test priečinok',
    });
    folderId = made.data.id;
  });
  afterAll(async () => {
    await api.close();
  });

  /** The browser's upload: ask, put the bytes where the API said, confirm. */
  async function upload(name: string, bytes: Uint8Array, mime: string, into = folderId) {
    const asked = await jana.call<{ fileId: string; versionId: string }>('file.requestUpload', {
      folderId: into,
      name,
      size: bytes.byteLength,
    });
    await bucket.storage.put(storageKey(asked.data.fileId, asked.data.versionId), bytes, mime);
    const confirmed = await jana.call<{ number: number }>('file.confirmUpload', {
      versionId: asked.data.versionId,
    });
    return { ...asked.data, confirmed };
  }

  it('accepts an upload whose bytes match its type, and numbers it v1', async () => {
    const pdf = await upload('Zmluva.pdf', PDF, 'application/pdf');
    expect(pdf.confirmed.code).toBeUndefined();
    expect(pdf.confirmed.data.number).toBe(1);
  });

  it('refuses bytes that are not what the name says, and deletes them', async () => {
    const fake = await upload('Falošné.pdf', text('not a pdf'), 'application/pdf');
    expect(fake.confirmed.message).toBe('UPLOAD_MISMATCH');
    expect(bucket.objects.has(storageKey(fake.fileId, fake.versionId))).toBe(false);
  });

  it('adds versions and restores an older one as the newest', async () => {
    const first = await upload('Poznámky.txt', text('prvá'), 'text/plain');
    const second = text('druhá');
    const asked = await jana.call<{ versionId: string }>('file.requestVersion', {
      fileId: first.fileId,
      name: 'Poznámky.txt',
      size: second.byteLength,
      note: 'druhá',
    });
    await bucket.storage.put(storageKey(first.fileId, asked.data.versionId), second, 'text/plain');
    expect(
      (await jana.call<{ number: number }>('file.confirmUpload', asked.data)).data.number,
    ).toBe(2);
    await jana.call('file.restoreVersion', { versionId: first.versionId });
    const detail = await jana.call<{ versions: { number: number; restoredFrom: number | null }[] }>(
      'file.get',
      { id: first.fileId },
    );
    expect(detail.data.versions[0]).toMatchObject({ number: 3, restoredFrom: 1 });
  });

  it('keeps folder names unique and refuses deleting a folder with files', async () => {
    const twin = await jana.call('file.createFolder', {
      parentId: COMPANY_ROOT_FOLDER_ID,
      name: 'test PRIEČINOK',
    });
    expect(twin.message).toBe('NAME_TAKEN');
    expect((await jana.call('file.deleteFolder', { id: folderId })).message).toBe(
      'FOLDER_NOT_EMPTY',
    );
  });

  it('starts an e-mail with a file attached („Priložiť k e-mailu“), never a trashed one', async () => {
    const file = await upload('Cenník.pdf', PDF, 'application/pdf');
    const draft = await jana.call<{ id: string }>('campaign.create', {
      customerIds: [],
      fileIds: [file.fileId],
    });
    const got = await jana.call<{ attachments: { id: string }[] }>('campaign.get', {
      id: draft.data.id,
    });
    expect(got.data.attachments.map((a) => a.id)).toEqual([file.fileId]);
    await jana.call('file.trashFile', { id: file.fileId });
    const refused = await jana.call('campaign.create', { customerIds: [], fileIds: [file.fileId] });
    expect(refused.message).toBe('FILE_NOT_FOUND');
  });

  it('moves a file to the trash and back', async () => {
    const file = await upload('Kôš.txt', text('x'), 'text/plain');
    await jana.call('file.trashFile', { id: file.fileId });
    expect((await jana.call('file.download', { id: file.fileId })).code).toBe('NOT_FOUND');
    await jana.call('file.restoreFile', { id: file.fileId });
    expect((await jana.call('file.download', { id: file.fileId })).code).toBeUndefined();
  });
});
