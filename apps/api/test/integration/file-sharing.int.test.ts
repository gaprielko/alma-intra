import { ACTIVITY_TYPE_DOCUMENT_CHANGE_ID, COMPANY_ROOT_FOLDER_ID } from '@intra/shared/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { storageKey } from '../../src/storage/storage.js';
import { parseFragments } from '../../src/sharing/share-html.js';
import { browser, JANA, startApi } from './client.js';
import { memoryStorage } from './memory-storage.js';

const text = (value: string) => new TextEncoder().encode(value);
const DOC = `<!doctype html><html><head><title>N</title></head><body>
<h1>Nadpis</h1><p>Prvý odsek</p><p>Druhý odsek</p><p>Tretí odsek</p>
<script>window.own = 1</script></body></html>`;
const blockOf = (html: string, doc = DOC) =>
  parseFragments(doc).findIndex((f) => doc.slice(f.start, f.end).includes(html));
const PASSWORD = 'heslo-pre-navrh';

describe('file sharing', () => {
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
      name: 'Zdieľanie',
    });
    folderId = made.data.id;
  });
  afterAll(async () => {
    await api.close();
  });

  async function upload(name: string, bytes: Uint8Array, mime: string) {
    const asked = await jana.call<{ fileId: string; versionId: string }>('file.requestUpload', {
      folderId,
      name,
      size: bytes.byteLength,
    });
    await bucket.storage.put(storageKey(asked.data.fileId, asked.data.versionId), bytes, mime);
    await jana.call('file.confirmUpload', { versionId: asked.data.versionId });
    return asked.data;
  }

  /** An HTML file with a link in this mode, and the link's token. */
  async function shared(mode: 'read' | 'comment' | 'edit', password: string | null = PASSWORD) {
    const file = await upload(`Dokument ${Math.random()}.html`, text(DOC), 'text/html');
    const saved = await jana.call<{ url: string }>('fileShare.save', {
      fileId: file.fileId,
      mode,
      ...(password ? { password } : {}),
    });
    expect(saved.code).toBeUndefined();
    return { ...file, token: saved.data.url.split('#')[1]! };
  }

  async function visitor(token: string, name = 'Ján Novák') {
    const person = browser(api.baseUrl);
    const unlocked = await person.call('publicShare.unlock', { token, name, password: PASSWORD });
    expect(unlocked.code).toBeUndefined();
    return person;
  }

  const op = (html: string, newHtml: string) => ({
    block: blockOf(html),
    kind: 'edit' as const,
    html: newHtml,
  });

  async function saveDraft(
    person: ReturnType<typeof browser>,
    token: string,
    versionId: string,
    ops: { block: number; kind: 'edit' | 'delete'; html?: string }[],
  ) {
    const saved = await person.call<{ draftId: string }>('publicShare.saveDraft', {
      token,
      baseVersionId: versionId,
      ops,
    });
    expect(saved.code).toBeUndefined();
    return saved.data.draftId;
  }

  describe('the link', () => {
    it('tells nothing about the file before the access screen, and asks what the mode needs', async () => {
      const { token } = await shared('edit');
      const stranger = browser(api.baseUrl);
      const info = await stranger.call<Record<string, unknown>>('publicShare.info', { token });
      expect(info.data).toEqual({
        open: false,
        needsPassword: true,
        needsName: true,
        returningName: null,
      });
      expect((await stranger.call('publicShare.open', { token })).message).toBe('LOCKED');
      expect((await stranger.call('publicShare.download', { token })).message).toBe('LOCKED');
    });

    it('needs a password for comments and edits, and only HTML has them', async () => {
      const html = await upload('A.html', text(DOC), 'text/html');
      const none = await jana.call('fileShare.save', { fileId: html.fileId, mode: 'edit' });
      expect(none.message).toBe('PASSWORD_REQUIRED');
      const pdf = await upload('B.pdf', text('%PDF-1.4\n'), 'application/pdf');
      const notHtml = await jana.call('fileShare.save', {
        fileId: pdf.fileId,
        mode: 'comment',
        password: PASSWORD,
      });
      expect(notHtml.message).toBe('NOT_HTML');
    });

    it('opens without a password when reading is all it allows', async () => {
      const { token } = await shared('read', null);
      const anybody = browser(api.baseUrl);
      expect((await anybody.call<{ open: boolean }>('publicShare.info', { token })).data.open).toBe(
        true,
      );
      const opened = await anybody.call<{ frame: string; mode: string }>('publicShare.open', {
        token,
      });
      expect(opened.data.mode).toBe('read');
      expect((await anybody.call('publicShare.comments', { token })).message).toBe('NOT_ALLOWED');
    });

    it('refuses a wrong password and counts it per link', async () => {
      const { token } = await shared('read');
      const stranger = browser(api.baseUrl);
      const wrong = await stranger.call('publicShare.unlock', { token, password: 'nesprávne' });
      expect(wrong.message).toBe('WRONG_PASSWORD');
      const refused = [];
      for (let i = 0; i < 21; i += 1) {
        refused.push((await stranger.call('publicShare.unlock', { token, password: 'x' })).code);
      }
      expect(refused).toContain('TOO_MANY_REQUESTS');
      // A correct one is refused too while locked: guessing cannot find out which is right.
      const locked = await stranger.call('publicShare.unlock', { token, password: PASSWORD });
      expect(locked.code).toBe('TOO_MANY_REQUESTS');
    });

    it('an unknown, a cancelled and an expired link and a trashed file look the same', async () => {
      const stranger = browser(api.baseUrl);
      const unknown = await stranger.call('publicShare.info', { token: 'a'.repeat(43) });
      expect(unknown.message).toBe('NOT_FOUND');

      const cancelled = await shared('read');
      await jana.call('fileShare.cancel', { fileId: cancelled.fileId });
      const a = await stranger.call('publicShare.info', { token: cancelled.token });
      expect(a.message).toBe('NOT_FOUND');

      const trashed = await shared('read');
      await jana.call('file.trashFile', { id: trashed.fileId });
      const b = await stranger.call('publicShare.info', { token: trashed.token });
      expect(b.message).toBe('NOT_FOUND');

      const expired = await shared('read');
      await jana.call('fileShare.save', {
        fileId: expired.fileId,
        mode: 'read',
        expiresOn: '2020-01-01',
      });
      const c = await stranger.call('publicShare.info', { token: expired.token });
      expect(c.message).toBe('NOT_FOUND');
    });

    it('a new password ends the sessions opened with the old one', async () => {
      const { token, fileId } = await shared('comment');
      const person = await visitor(token);
      expect((await person.call('publicShare.open', { token })).code).toBeUndefined();
      await jana.call('fileShare.save', { fileId, mode: 'comment', password: 'nove-heslo-123' });
      expect((await person.call('publicShare.open', { token })).message).toBe('LOCKED');
    });

    it('a lowered mode applies at the next request, whatever the cookie says', async () => {
      const { token, fileId, versionId } = await shared('edit');
      const person = await visitor(token);
      await jana.call('fileShare.save', { fileId, mode: 'read' });
      const refused = await person.call('publicShare.saveDraft', {
        token,
        baseVersionId: versionId,
        ops: [{ block: 1, kind: 'delete' }],
      });
      expect(refused.message).toBe('NOT_ALLOWED');
      const comment = await person.call('publicShare.addComment', { token, body: 'x' });
      expect(comment.message).toBe('NOT_ALLOWED');
    });

    it('a cookie of one link opens no other', async () => {
      const one = await shared('comment');
      const other = await shared('comment');
      const person = await visitor(one.token);
      expect((await person.call('publicShare.open', { token: other.token })).message).toBe(
        'LOCKED',
      );
    });

    it('a colleague signed in is a visitor like any other', async () => {
      const { token } = await shared('edit');
      expect((await jana.call('publicShare.open', { token })).message).toBe('LOCKED');
    });

    it('a colleague cannot change a link without signing in', async () => {
      const { fileId } = await shared('read');
      const stranger = browser(api.baseUrl);
      expect((await stranger.call('fileShare.cancel', { fileId })).code).toBe('UNAUTHORIZED');
    });
  });

  describe('the frame', () => {
    it('serves the document under its own sandbox, and a bad token gets nothing', async () => {
      const { token } = await shared('read', null);
      const anybody = browser(api.baseUrl);
      const opened = await anybody.call<{ frame: string }>('publicShare.open', { token });
      const res = await fetch(`${api.baseUrl}${opened.data.frame}`);
      expect(res.status).toBe(200);
      const policy = res.headers.get('content-security-policy')!;
      expect(policy).toContain('sandbox allow-scripts');
      expect(policy).not.toContain('allow-same-origin');
      expect(policy).toContain("connect-src 'none'");
      const page = await res.text();
      expect(page).toContain('window.own = 1');
      expect(page).toContain('data-alma-b="0"');
      expect((await fetch(`${api.baseUrl}${opened.data.frame}x`)).status).toBe(404);
    });
  });

  describe('drafts', () => {
    it('never makes a version, and makes an activity', async () => {
      const { token, fileId, versionId } = await shared('edit');
      const person = await visitor(token);
      const draftId = await saveDraft(person, token, versionId, [
        op('Prvý odsek', '<p>Prvý <strong>nový</strong> odsek</p>'),
      ]);
      const file = await jana.call<{ versions: unknown[]; currentVersionId: string }>('file.get', {
        id: fileId,
      });
      expect(file.data.versions).toHaveLength(1);
      expect(file.data.currentVersionId).toBe(versionId);
      const list = await jana.call<{ items: { fileDraftId: string; typeId: string }[] }>(
        'leadActivity.list',
        {},
      );
      const activity = list.data.items.find((item) => item.fileDraftId === draftId);
      expect(activity?.typeId).toBe(ACTIVITY_TYPE_DOCUMENT_CHANGE_ID);
    });

    it('an outsider cannot bring in a script, a handler, a frame or a new picture', async () => {
      const { token, versionId } = await shared('edit');
      const person = await visitor(token);
      const draftId = await saveDraft(person, token, versionId, [
        op(
          'Prvý odsek',
          '<p onclick="x()">A<script>alert(1)</script><iframe src="https://e.test"></iframe>' +
            '<img src="https://e.test/t.png"><a href="javascript:alert(1)">B</a></p>',
        ),
      ]);
      const draft = await jana.call<{ changes: { newHtml: string }[] }>('fileShare.draft', {
        id: draftId,
      });
      expect(draft.data.changes[0]!.newHtml).toBe('<p>A<a>B</a></p>');
    });

    it('refuses editing a block that cannot go through the editor', async () => {
      const doc = '<html><body><svg><circle r="1"></circle></svg><p>a</p></body></html>';
      const file = await upload(`S ${Math.random()}.html`, text(doc), 'text/html');
      const saved = await jana.call<{ url: string }>('fileShare.save', {
        fileId: file.fileId,
        mode: 'edit',
        password: PASSWORD,
      });
      const token = saved.data.url.split('#')[1]!;
      const person = await visitor(token);
      const refused = await person.call('publicShare.saveDraft', {
        token,
        baseVersionId: file.versionId,
        ops: [{ block: 0, kind: 'edit', html: '<p>x</p>' }],
      });
      expect(refused.message).toBe('NOT_EDITABLE');
      expect((await person.call('publicShare.fragment', { token, block: 0 })).message).toBe(
        'NOT_EDITABLE',
      );
    });

    it('from approval to a version: approved in, rejected out, everything else byte for byte', async () => {
      const { token, fileId, versionId } = await shared('edit');
      const person = await visitor(token);
      const draftId = await saveDraft(person, token, versionId, [
        op('Prvý odsek', '<p>Prvý nový odsek</p>'),
        op('Druhý odsek', '<p>Zamietnutý text</p>'),
        { block: blockOf('Tretí odsek'), kind: 'delete' },
      ]);
      const comment = await person.call<{ id: string }>('publicShare.addComment', {
        token,
        body: 'Otázka?',
        anchor: {
          block: 1,
          quote: 'Nadpis',
          prefix: null,
          suffix: null,
          tag: null,
          src: null,
        },
      });

      const detail = async () =>
        (
          await jana.call<{
            changes: { id: string; oldHtml: string }[];
            remainingChanges: number;
            remainingComments: number;
          }>('fileShare.draft', { id: draftId })
        ).data;
      const before = await detail();
      expect(before.remainingChanges).toBe(3);
      expect(before.remainingComments).toBe(1);
      expect((await jana.call('fileShare.finish', { id: draftId })).message).toBe('NOT_READY');

      for (const change of before.changes) {
        await jana.call('fileShare.decide', {
          changeId: change.id,
          decision: change.oldHtml.includes('Druhý') ? 'rejected' : 'approved',
        });
      }
      expect((await jana.call('fileShare.finish', { id: draftId })).message).toBe('NOT_READY');
      await jana.call('fileShare.reply', {
        draftId,
        commentId: comment.data.id,
        body: 'Odpoveď',
      });
      await jana.call('fileShare.agree', {
        draftId,
        commentId: comment.data.id,
        agreed: true,
      });
      const finished = await jana.call<{ version: number; versionId: string }>('fileShare.finish', {
        id: draftId,
      });
      expect(finished.data.version).toBe(2);
      const stored = new TextDecoder().decode(
        (await bucket.storage.read(storageKey(fileId, finished.data.versionId))) as Uint8Array,
      );
      expect(stored).toBe(
        DOC.replace('<p>Prvý odsek</p>', '<p>Prvý nový odsek</p>').replace(
          '<p>Tretí odsek</p>',
          '',
        ),
      );
      const file = await jana.call<{
        versions: { createdVia: string; externalAuthor: string; createdBy: string }[];
      }>('file.get', { id: fileId });
      expect(file.data.versions[0]).toMatchObject({
        createdVia: 'share',
        externalAuthor: 'Ján Novák',
      });
      expect(file.data.versions[0]!.createdBy).toBeTruthy();
    });

    it('all rejected closes the draft without a version', async () => {
      const { token, fileId, versionId } = await shared('edit');
      const person = await visitor(token);
      const draftId = await saveDraft(person, token, versionId, [op('Prvý odsek', '<p>Nie</p>')]);
      const detail = await jana.call<{ changes: { id: string }[] }>('fileShare.draft', {
        id: draftId,
      });
      await jana.call('fileShare.decide', {
        changeId: detail.data.changes[0]!.id,
        decision: 'rejected',
      });
      const finished = await jana.call<{ version: null }>('fileShare.finish', { id: draftId });
      expect(finished.data.version).toBeNull();
      const file = await jana.call<{ versions: unknown[] }>('file.get', { id: fileId });
      expect(file.data.versions).toHaveLength(1);
    });

    it('merges: the same change once, alternatives on one fragment, comments together', async () => {
      const { token, fileId, versionId } = await shared('edit');
      const ann = await visitor(token, 'Anna');
      const ben = await visitor(token, 'Ben');
      const a = await saveDraft(ann, token, versionId, [
        op('Prvý odsek', '<p>Rovnaký</p>'),
        op('Druhý odsek', '<p>Annin</p>'),
      ]);
      const b = await saveDraft(ben, token, versionId, [
        op('Prvý odsek', '<p>Rovnaký</p>'),
        op('Druhý odsek', '<p>Benov</p>'),
      ]);
      await ben.call('publicShare.addComment', { token, body: 'Komentár' });
      const merged = await jana.call<{ id: string }>('fileShare.merge', { fileId, ids: [a, b] });
      const detail = await jana.call<{
        authorNames: string[];
        changes: { id: string; block: number; newHtml: string; decision: string }[];
        comments: unknown[];
      }>('fileShare.draft', { id: merged.data.id });
      expect(detail.data.authorNames.sort()).toEqual(['Anna', 'Ben']);
      expect(detail.data.changes).toHaveLength(3);
      expect(detail.data.comments).toHaveLength(1);

      const annin = detail.data.changes.find((c) => c.newHtml === '<p>Annin</p>')!;
      const benov = detail.data.changes.find((c) => c.newHtml === '<p>Benov</p>')!;
      expect(annin.block).toBe(benov.block);
      await jana.call('fileShare.decide', { changeId: annin.id, decision: 'approved' });
      const after = await jana.call<{ changes: { id: string; decision: string }[] }>(
        'fileShare.draft',
        { id: merged.data.id },
      );
      expect(after.data.changes.find((c) => c.id === benov.id)!.decision).toBe('rejected');

      const again = await jana.call('fileShare.merge', { fileId, ids: [a, b] });
      expect(again.message).toBe('NOT_WAITING');
    });

    it('a change whose fragment changed in a newer version no longer fits', async () => {
      const { token, fileId, versionId } = await shared('edit');
      const person = await visitor(token);
      const draftId = await saveDraft(person, token, versionId, [
        op('Prvý odsek', '<p>Moja zmena</p>'),
        op('Druhý odsek', '<p>Druhá zmena</p>'),
      ]);
      const newer = text(DOC.replace('Prvý odsek', 'Medzitým zmenený'));
      const asked = await jana.call<{ versionId: string }>('file.requestVersion', {
        fileId,
        name: 'x.html',
        size: newer.byteLength,
      });
      await bucket.storage.put(storageKey(fileId, asked.data.versionId), newer, 'text/html');
      await jana.call('file.confirmUpload', { versionId: asked.data.versionId });

      const detail = await jana.call<{
        changes: { id: string; fits: boolean; newHtml: string }[];
      }>('fileShare.draft', { id: draftId });
      const lost = detail.data.changes.find((c) => c.newHtml === '<p>Moja zmena</p>')!;
      const kept = detail.data.changes.find((c) => c.newHtml === '<p>Druhá zmena</p>')!;
      expect(lost.fits).toBe(false);
      expect(kept.fits).toBe(true);
      const refused = await jana.call('fileShare.decide', {
        changeId: lost.id,
        decision: 'approved',
      });
      expect(refused.message).toBe('NOT_READY');
    });
  });

  describe('comments', () => {
    it('are a draft by themselves, one per visit, finished when the last is agreed to', async () => {
      const { token, fileId } = await shared('comment');
      const person = await visitor(token);
      const first = await person.call<{ id: string }>('publicShare.addComment', {
        token,
        body: 'Prvý',
      });
      const second = await person.call<{ id: string }>('publicShare.addComment', {
        token,
        body: 'Druhý',
      });
      const drafts = await jana.call<{ id: string; state: string; comments: number }[]>(
        'fileShare.drafts',
        { fileId },
      );
      expect(drafts.data).toHaveLength(1);
      expect(drafts.data[0]).toMatchObject({ state: 'waiting', comments: 2 });
      const draftId = drafts.data[0]!.id;
      await jana.call('fileShare.agree', { draftId, commentId: first.data.id, agreed: true });
      await jana.call('fileShare.agree', { draftId, commentId: second.data.id, agreed: true });
      const after = await jana.call<{ state: string }[]>('fileShare.drafts', { fileId });
      expect(after.data[0]!.state).toBe('finished');
    });

    it('a visitor changes only their own, until a colleague agrees to it', async () => {
      const { token, fileId } = await shared('comment');
      const own = await visitor(token, 'Vlastník');
      const other = await visitor(token, 'Iný');
      const made = await own.call<{ id: string }>('publicShare.addComment', {
        token,
        body: 'Pôvodný',
      });
      const id = made.data.id;
      expect((await other.call('publicShare.editComment', { token, id, body: 'x' })).message).toBe(
        'NOT_YOURS',
      );
      expect((await other.call('publicShare.deleteComment', { token, id })).message).toBe(
        'NOT_YOURS',
      );
      expect(
        (await own.call('publicShare.editComment', { token, id, body: 'Nový' })).code,
      ).toBeUndefined();
      const seen = await other.call<{ id: string; body: string; own: boolean }[]>(
        'publicShare.comments',
        { token },
      );
      expect(seen.data[0]).toMatchObject({ body: 'Nový', own: false });

      const drafts = await jana.call<{ id: string }[]>('fileShare.drafts', { fileId });
      await jana.call('fileShare.agree', {
        draftId: drafts.data[0]!.id,
        commentId: id,
        agreed: true,
      });
      expect((await own.call('publicShare.editComment', { token, id, body: 'y' })).message).toBe(
        'NOT_YOURS',
      );
      const after = await own.call<unknown[]>('publicShare.comments', { token });
      expect(after.data).toHaveLength(0);
    });

    it('recognizes this browser without its name, keeps its comments, and forgets it on request', async () => {
      const { token, fileId } = await shared('comment');
      const person = await visitor(token);
      const made = await person.call<{ id: string }>('publicShare.addComment', {
        token,
        body: 'Môj',
      });
      // The session ends with a new password; the browser is still known.
      await jana.call('fileShare.save', { fileId, mode: 'comment', password: 'nove-heslo-123' });
      const info = await person.call<{ needsName: boolean; returningName: string }>(
        'publicShare.info',
        { token },
      );
      expect(info.data).toMatchObject({ needsName: false, returningName: 'Ján Novák' });
      const back = await person.call('publicShare.unlock', { token, password: 'nove-heslo-123' });
      expect(back.code).toBeUndefined();
      const list = await person.call<{ own: boolean }[]>('publicShare.comments', { token });
      expect(list.data[0]!.own).toBe(true);
      expect(
        (
          await person.call('publicShare.editComment', {
            token,
            id: made.data.id,
            body: 'Zmenený',
          })
        ).code,
      ).toBeUndefined();

      await person.call('publicShare.forget', { token });
      const forgotten = await person.call<{ needsName: boolean; returningName: string | null }>(
        'publicShare.info',
        { token },
      );
      expect(forgotten.data).toMatchObject({ needsName: true, returningName: null });
    });

    it('deleting the last comment of a comments-only draft discards it', async () => {
      const { token, fileId } = await shared('comment');
      const person = await visitor(token);
      const made = await person.call<{ id: string }>('publicShare.addComment', {
        token,
        body: 'Omyl',
      });
      await person.call('publicShare.deleteComment', { token, id: made.data.id });
      const drafts = await jana.call<{ state: string }[]>('fileShare.drafts', { fileId });
      expect(drafts.data[0]!.state).toBe('discarded');
    });

    it('a visit after the comments-only draft: the save fills it, the next save is its own', async () => {
      const { token, fileId, versionId } = await shared('edit');
      const person = await visitor(token);
      await person.call('publicShare.addComment', { token, body: 'Komentár' });
      await saveDraft(person, token, versionId, [op('Prvý odsek', '<p>A</p>')]);
      await saveDraft(person, token, versionId, [op('Prvý odsek', '<p>B</p>')]);
      const drafts = await jana.call<{ changes: number; comments: number }[]>('fileShare.drafts', {
        fileId,
      });
      expect(drafts.data).toHaveLength(2);
      expect(drafts.data.every((d) => d.changes === 1 && d.comments === 1)).toBe(true);
    });
  });

  it('the audit trail holds no name, comment or password', async () => {
    const { token, versionId } = await shared('edit');
    const person = await visitor(token, 'Tajné Meno');
    await person.call('publicShare.addComment', { token, body: 'Tajný komentár' });
    await saveDraft(person, token, versionId, [op('Prvý odsek', '<p>Tajná zmena</p>')]);
    const rows = await api.db.execute<{ diff: unknown; ip_hash: unknown }>(
      "select diff from audit_events where action like 'publicShare.%' or action like 'fileShare.%'",
    );
    const all = JSON.stringify(rows.rows);
    expect(all).not.toContain('Tajn');
    expect(all).not.toContain(PASSWORD);
  });
});
