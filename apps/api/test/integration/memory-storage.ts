import type { Storage } from '../../src/storage/storage.js';

/**
 * A bucket in memory for the API under test: signed URLs are fake (`memory://<key>`), and a
 * test "uploads" by calling `put` itself with the key the API chose.
 */
export function memoryStorage() {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  const storage: Storage = {
    createUploadUrl: (key) =>
      Promise.resolve({ url: `memory://${key}`, expiresAt: new Date(Date.now() + 60_000) }),
    createDownloadUrl: (key) =>
      Promise.resolve({ url: `memory://${key}`, expiresAt: new Date(Date.now() + 60_000) }),
    head: (key) => {
      const object = objects.get(key);
      return Promise.resolve(
        object ? { contentType: object.contentType, contentLength: object.body.byteLength } : null,
      );
    },
    read: (key) => Promise.resolve(objects.get(key)?.body ?? new Uint8Array()),
    readPrefix: (key, length) =>
      Promise.resolve((objects.get(key)?.body ?? new Uint8Array()).slice(0, length)),
    put: (key, body, contentType) => {
      objects.set(key, { body, contentType });
      return Promise.resolve();
    },
    copy: (from, to) => {
      const object = objects.get(from);
      if (object) objects.set(to, object);
      return Promise.resolve();
    },
    delete: (key) => {
      objects.delete(key);
      return Promise.resolve();
    },
  };
  return { storage, objects };
}
