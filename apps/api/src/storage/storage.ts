import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { FILE_URL_TTL_SECONDS } from '@intra/shared/schemas';
import type { Env, StorageEnv } from '../config/env.js';
import { storageEnvOf } from '../config/env.js';

/**
 * Object storage behind the API: a private S3-compatible bucket (Hetzner Object Storage in
 * production, SeaweedFS locally). Files never pass through the API process: the browser uploads
 * and downloads with short-lived signed URLs. What the services see; free of AWS SDK types so the
 * tRPC clients do not compile them.
 */
export interface Storage {
  /**
   * A signed PUT for exactly this object, content type and length: a request with another type or
   * size does not match the signature and is refused by the bucket.
   */
  createUploadUrl(
    key: string,
    object: { contentType: string; contentLength: number },
  ): Promise<SignedUrl>;
  /**
   * A signed GET. `inline` shows the object in the browser as `contentType` (a PDF, a photo);
   * otherwise it is saved as `fileName`.
   */
  createDownloadUrl(
    key: string,
    options: { fileName: string; contentType: string; inline: boolean },
  ): Promise<SignedUrl>;
  /** What the bucket holds under the key (the truth about an upload), or `null` when nothing. */
  head(key: string): Promise<{ contentType: string | null; contentLength: number | null } | null>;
  /** The first `length` bytes of the object (a ranged GET), for a look at the file signature. */
  readPrefix(key: string, length: number): Promise<Uint8Array>;
  /**
   * Bytes the server has in hand (a received e-mail's attachment), written directly; everything a
   * person uploads goes through a signed PUT instead.
   */
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** A copy inside the bucket: a restored version gets an object of its own. */
  copy(fromKey: string, toKey: string): Promise<void>;
  /** Idempotent: deleting what is not there is not an error. */
  delete(key: string): Promise<void>;
}

export interface SignedUrl {
  url: string;
  expiresAt: Date;
}

/**
 * Where a version of a file lives: ids only, never a name somebody typed. A UUID is unguessable,
 * and the bucket is private anyway.
 */
export const storageKey = (fileId: string, versionId: string) => `files/${fileId}/${versionId}`;

/**
 * `Content-Disposition` for a name a person typed: an ASCII fallback without quotes or control
 * characters, and the real name in RFC 5987 form for every browser that reads it.
 */
export function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const ascii =
    fileName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]|["\\]/g, '_')
      .trim() || 'subor';
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

const expiry = (seconds: number) => new Date(Date.now() + seconds * 1000);
const CONNECT_TIMEOUT_MS = 3_000;
const REQUEST_TIMEOUT_MS = 10_000;

function createClient(config: StorageEnv) {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // `https://<endpoint>/<bucket>/<key>`: Hetzner and SeaweedFS serve buckets as paths.
    forcePathStyle: true,
    // The SDK's default CRC32 checksums are AWS-specific and would end up in the signed URLs.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    // A bucket that hangs must not hold a request for long: one retry, short timeouts.
    maxAttempts: 2,
    requestHandler: { connectionTimeout: CONNECT_TIMEOUT_MS, requestTimeout: REQUEST_TIMEOUT_MS },
  });
}

export function createStorageClient(config: StorageEnv): Storage {
  const client = createClient(config);
  const Bucket = config.bucket;

  return {
    async createUploadUrl(key, object) {
      const expiresIn = FILE_URL_TTL_SECONDS.upload;
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket,
          Key: key,
          ContentType: object.contentType,
          ContentLength: object.contentLength,
        }),
        {
          expiresIn,
          // The presigner leaves `content-type` out of the signature by default; both headers are
          // part of it here, so the client must send exactly what was requested.
          signableHeaders: new Set(['content-type', 'content-length']),
        },
      );
      return { url, expiresAt: expiry(expiresIn) };
    },

    async createDownloadUrl(key, options) {
      const expiresIn = FILE_URL_TTL_SECONDS.download;
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentType: options.inline ? options.contentType : 'application/octet-stream',
          ResponseContentDisposition: contentDisposition(
            options.inline ? 'inline' : 'attachment',
            options.fileName,
          ),
        }),
        { expiresIn },
      );
      return { url, expiresAt: expiry(expiresIn) };
    },

    async head(key) {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return {
          contentType: result.ContentType ?? null,
          contentLength: result.ContentLength ?? null,
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async readPrefix(key, length) {
      const result = await client.send(
        new GetObjectCommand({ Bucket, Key: key, Range: `bytes=0-${String(length - 1)}` }),
      );
      return (await result.Body?.transformToByteArray()) ?? new Uint8Array();
    },

    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.byteLength,
        }),
      );
    },

    async copy(fromKey, toKey) {
      await client.send(
        new CopyObjectCommand({ Bucket, Key: toKey, CopySource: `${Bucket}/${fromKey}` }),
      );
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}

/** HEAD answers 404 without a body, so the SDK reports it as `NotFound` or by status. */
function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NotFound' || e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
}

/**
 * The browser uploads and downloads straight from the bucket, so the bucket must allow the web's
 * origin. Set once per environment: `node dist/storage/bucket-cors.cli.js` in the image.
 */
export async function setBucketCors(config: StorageEnv, webUrl: string) {
  await createClient(config).send(
    new PutBucketCorsCommand({
      Bucket: config.bucket,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: [new URL(webUrl).origin],
            AllowedMethods: ['GET', 'PUT', 'HEAD'],
            AllowedHeaders: ['content-type'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
}

/** Development only: the local bucket is created on start, with its CORS rule. */
export async function prepareLocalBucket(config: StorageEnv, webUrl: string) {
  const client = createClient(config);
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
  } catch (error) {
    if (!isNotFound(error)) throw error;
    await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
  }
  await setBucketCors(config, webUrl);
}

/** `null` without the S3 variables (dev and tests); production must have them. */
export function createStorage(env: Env): Storage | null {
  const config = storageEnvOf(env);
  if (!config) {
    if (env.NODE_ENV === 'production') throw new Error('S3 storage is required in production');
    return null;
  }
  return createStorageClient(config);
}
