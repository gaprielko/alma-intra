import { sk } from '@intra/shared/i18n';
import { create } from 'zustand';
import { errorMessage, errorReason } from '@/lib/errors';
import { uploadRefusal } from '@/lib/files';
import { queryClient, trpc, trpcClient } from '@/lib/trpc';

const t = sk.files.uploads;

export interface UploadItem {
  id: number;
  name: string;
  /** 0 to 1, of the bytes sent to the bucket. */
  progress: number;
  status: 'waiting' | 'uploading' | 'done' | 'failed';
  /** Why it failed, worded for the panel. */
  error?: string;
}

interface UploadState {
  items: UploadItem[];
  collapsed: boolean;
  toggle: () => void;
  /** Clears the panel once nothing is running. */
  dismiss: () => void;
}

export const useUploads = create<UploadState>((set) => ({
  items: [],
  collapsed: false,
  toggle: () => set((state) => ({ collapsed: !state.collapsed })),
  dismiss: () =>
    set((state) =>
      state.items.some((item) => item.status === 'waiting' || item.status === 'uploading')
        ? state
        : { items: [], collapsed: false },
    ),
}));

let nextId = 1;
const update = (id: number, patch: Partial<UploadItem>) =>
  useUploads.setState((state) => ({
    items: state.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
  }));

/** One file at a time: the bucket sees one PUT, the list fills in order. */
let queue: Promise<void> = Promise.resolve();

/**
 * The bytes go straight to the bucket: a signed PUT bound to the type and size the API named. An
 * XHR rather than `fetch`, for the progress of the upload.
 */
function put(url: string, file: File, contentType: string, onProgress: (share: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`PUT ${xhr.status}`));
    xhr.onerror = () => reject(new Error('PUT failed'));
    xhr.send(file);
  });
}

/** The lists, the trees and the customer's card show the new file. */
async function refresh() {
  await queryClient.invalidateQueries(trpc.file.pathFilter());
}

function failure(error: unknown): string {
  if (errorReason(error) === 'UPLOAD_MISMATCH') return t.mismatch;
  return errorMessage(error, sk.files.errors, t.failed);
}

async function uploadOne(id: number, file: File, folderId: string) {
  update(id, { status: 'uploading' });
  try {
    const request = await trpcClient.file.requestUpload.mutate({
      folderId,
      name: file.name,
      size: file.size,
    });
    await put(request.url, file, request.contentType, (share) => update(id, { progress: share }));
    await trpcClient.file.confirmUpload.mutate({ versionId: request.versionId });
    update(id, { status: 'done', progress: 1 });
    await refresh();
  } catch (error) {
    update(id, { status: 'failed', error: failure(error) });
  }
}

/**
 * Uploads files into a folder, shown in the panel at the bottom right. A file the API would refuse
 * (type, size) fails at once with the reason, without a request.
 */
export function uploadFiles(files: Iterable<File>, folderId: string) {
  const added: { item: UploadItem; file: File }[] = [];
  for (const file of files) {
    const refusal = uploadRefusal(file);
    added.push({
      file,
      item: {
        id: nextId++,
        name: file.name,
        progress: 0,
        status: refusal ? 'failed' : 'waiting',
        ...(refusal ? { error: t[refusal] } : {}),
      },
    });
  }
  if (added.length === 0) return;
  useUploads.setState((state) => ({
    // A panel that only shows finished uploads starts over.
    items: [
      ...state.items.filter((item) => item.status === 'waiting' || item.status === 'uploading'),
      ...added.map(({ item }) => item),
    ],
    collapsed: false,
  }));
  for (const { item, file } of added) {
    if (item.status !== 'waiting') continue;
    queue = queue.then(() => uploadOne(item.id, file, folderId));
  }
}

/** A new version of a file: the same pipeline, answering the new version's number. */
export async function uploadVersion(
  file: File,
  fileId: string,
  note: string | undefined,
  onProgress: (share: number) => void,
) {
  const request = await trpcClient.file.requestVersion.mutate({
    fileId,
    name: file.name,
    size: file.size,
    note,
  });
  await put(request.url, file, request.contentType, onProgress);
  const confirmed = await trpcClient.file.confirmUpload.mutate({ versionId: request.versionId });
  await refresh();
  return confirmed.number;
}

/**
 * Saves a version under its own name. The bytes are fetched from the signed URL and handed over as
 * a blob: a cross-origin link would ignore `download`, and not every bucket honours the name the
 * signature asks for.
 */
export async function downloadFile(fileId: string, name: string, versionId?: string) {
  const { url } = await trpcClient.file.download.mutate({
    id: fileId,
    inline: false,
    ...(versionId ? { versionId } : {}),
  });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${response.status}`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

/**
 * A PDF or a photo in a new tab. The tab opens at once, inside the click, so no popup blocker
 * stops it; it is pointed at the signed URL once the API answered.
 */
export async function previewFile(fileId: string, versionId?: string) {
  const tab = window.open('', '_blank');
  try {
    const { url } = await trpcClient.file.download.mutate({
      id: fileId,
      inline: true,
      ...(versionId ? { versionId } : {}),
    });
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.location.assign(url);
    }
  } catch (error) {
    tab?.close();
    throw error;
  }
}
