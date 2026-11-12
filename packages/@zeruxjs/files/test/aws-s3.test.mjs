import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createS3Storage,
  createFileManager,
  validateAwsCredentialOptions,
  resolveAwsCredentials,
} from '../dist/index.js';
/** Fixed synthetic S3 address, never a real bucket target. */
const addr = { bucket: 'demo-bucket', key: 'pictures/example.webp' };
/** Emulate only the SDK commands needed by offline tests; no live S3 compatibility is certified.
 * @returns {object} Observable in-memory SDK-compatible fixture.
 */
function sdkClient() {
  /** In-memory object map backing the injected SDK fixture. */
  const files = new Map();
  /** Observed injected SDK commands retained only within this test. */
  const requests = [];
  let closed = false;
  return {
    requests,
    files,
    // lib-storage reads client configuration even when send() is injected.
    config: {
      requestHandler: {},
      forcePathStyle: true,
      endpoint: async () => ({
        protocol: 'https:',
        hostname: 'minio.example.com',
      }),
    },
    get closed() {
      return closed;
    },
    destroy() {
      closed = true;
    },
    async send(cmd) {
      /** Trusted SDK command constructor name used by the fixture dispatcher. */
      const name = cmd.constructor.name;
      /** Private synthetic command input recorded for exact adapter assertions. */
      const params = cmd.input;
      requests.push({ name, params });
      /** In-memory bucket/key identity; not a filesystem or remote URL. */
      const k = `${params.Bucket}/${params.Key}`;
      if (name === 'HeadObjectCommand') {
        if (!files.has(k)) {
          throw { name: 'NotFound', $metadata: { httpStatusCode: 404 } };
        }
        /** Previously stored in-memory object metadata and bytes. */
        const f = files.get(k);
        return {
          ContentLength: f.body.length,
          ContentType: f.ContentType,
          Metadata: f.Metadata,
          ETag: '"etag"',
          LastModified: new Date(),
          ServerSideEncryption: f.ServerSideEncryption,
        };
      }
      if (name === 'PutObjectCommand') {
        if (params.IfNoneMatch === '*' && files.has(k)) {
          throw {
            name: 'PreconditionFailed',
            $metadata: { httpStatusCode: 412 },
          };
        }
        files.set(k, { ...params, body: Buffer.from(params.Body) });
        return { ETag: '"etag"' };
      }
      if (name === 'GetObjectCommand') {
        if (!files.has(k)) {
          throw { name: 'NotFound' };
        }
        /** Stored byte buffer selected by the injected GetObject fixture. */
        const file = files.get(k).body;
        /** Single synthetic Range syntax match, without network or regex input expansion. */
        const match = params.Range && /^bytes=(\d+)-(\d*)$/.exec(params.Range);
        /** Selected synthetic body/range bytes returned through an async iterator. */
        const bytes = match
          ? file.subarray(
              Number(match[1]),
              match[2] ? Number(match[2]) + 1 : undefined
            )
          : file;
        return {
          Body: (async function* () {
            yield bytes;
          })(),
        };
      }
      if (name === 'DeleteObjectCommand') {
        files.delete(k);
        return {};
      }
      if (name === 'ListObjectsV2Command') {
        return {
          Contents: [...files]
            .filter(([key]) => key.startsWith(params.Bucket + '/'))
            .map(([key]) => ({ Key: key.split('/').slice(1).join('/') })),
        };
      }
      if (name === 'CopyObjectCommand') {
        /** Decoded fixture copy-source identity; never fetched remotely. */
        const source = decodeURIComponent(params.CopySource);
        /** Existing synthetic source object used to simulate native copy. */
        const original = files.get(source);
        if (!original) {
          throw new Error('Copy source missing');
        }
        files.set(k, {
          ...original,
          ...params,
          body: Buffer.from(original.body),
        });
        return {};
      }
      throw new Error(`Unexpected S3 command ${name}`);
    },
  };
}
test('S3-compatible endpoint and credential configuration is validated offline', async () => {
  assert.equal(validateAwsCredentialOptions({}), undefined);
  assert.equal(await resolveAwsCredentials({}, 'us-east-1'), undefined);
  /** Clearly synthetic credentials; tests do not resolve ambient host credentials. */
  const creds = { accessKeyId: 'EXAMPLE', secretAccessKey: 'SECRET' };
  assert.deepEqual(
    await resolveAwsCredentials({ credentials: creds }, 'eu-west-1'),
    creds
  );
  assert.throws(
    () => createS3Storage({ endpoint: 'http://rustfs.internal:9000' }),
    /HTTP S3 endpoints/
  );
  assert.equal(
    createS3Storage({
      region: 'us-east-1',
      endpoint: 'http://127.0.0.1:9000',
      allowInsecureHttp: true,
      credentials: creds,
    }).kind,
    'aws-s3'
  );
  assert.throws(
    () => createS3Storage({ endpoint: 'https://admin:secret@host/' }),
    /Invalid S3 endpoint/
  );
  assert.throws(
    () => createS3Storage({ endpoint: 'https://host:9000/?token=abc' }),
    /Invalid S3 endpoint/
  );
  assert.throws(
    () => createS3Storage({ credentials: creds, profile: 'dev' }),
    /Choose exactly one/
  );
  assert.throws(
    () =>
      createS3Storage({ assumeRole: { roleArn: 'arn:aws:iam::123:role/Bad' } }),
    /valid IAM role ARN/
  );
  assert.throws(
    () =>
      createS3Storage({
        webIdentity: { roleArn: 'invalid', tokenFile: '/tmp/token' },
      }),
    /valid IAM role ARN/
  );
  assert.throws(
    () =>
      createS3Storage({
        encryption: {
          mode: 'SSE-C',
          customerKeyBase64: Buffer.alloc(32).toString('base64'),
        },
        endpoint: 'http://localhost:9000',
        allowInsecureHttp: true,
      }),
    /HTTPS/
  );
  assert.equal(
    createS3Storage({
      assumeRole: {
        roleArn: 'arn:aws:iam::123456789012:role/StorageReader',
        externalId: 'tenant-id',
      },
    }).kind,
    'aws-s3'
  );
});
test('S3 PutObject conditional writes, metadata, HEAD/ranges and delete use SDK commands', async () => {
  /** Injected SDK-compatible fixture; it never creates a network connection. */
  const client = sdkClient();
  /** Explicit S3 wrapper under test; native client ownership is asserted. */
  const storage = createS3Storage({
    region: 'us-east-1',
    endpoint: 'https://minio.example.com',
    forcePathStyle: true,
    providerCapabilities: { range: true, createOnlyWrite: true },
    client,
    encryption: { mode: 'aws:kms', keyId: 'alias/files' },
  });
  /** Fixture manager borrowing the injected storage wrapper. */
  const manager = createFileManager({
    stores: [{ name: 's3', driver: storage }],
  });
  /** Fixed named synthetic S3 object address. */
  const a = { ...addr, storage: 's3' };
  /** Observed synthetic upload metadata, checked against sent command fields. */
  const info = await manager.put(a, Buffer.from('hello world'), {
    contentType: 'text/plain',
    visibility: 'public',
    cacheControl: 'public, max-age=60',
  });
  assert.equal(info.size, 11);
  assert.equal(info.visibility, 'public');
  /** Recorded PutObject input used to assert KMS/precondition metadata. */
  const request = client.requests.find((r) => r.name === 'PutObjectCommand');
  assert.equal(request.params.ServerSideEncryption, 'aws:kms');
  assert.equal(request.params.SSEKMSKeyId, 'alias/files');
  assert.equal(request.params.IfNoneMatch, '*');
  await assert.rejects(manager.put(a, Buffer.from('overwrite')), {
    code: 'FILE_EXISTS',
  });
  /** Small synthetic range chunks collected for exact byte comparison. */
  const parts = [];
  // Consume this bounded fixture stream completely before manager teardown.
  for await (const chunk of await manager.read(a, { start: 6, end: 10 })) {
    parts.push(chunk);
  }
  assert.equal(Buffer.concat(parts).toString(), 'world');
  assert.equal((await manager.list('demo-bucket')).items.length, 1);
  /** Distinct synthetic copy destination; overwriting is explicitly opted in. */
  const other = { ...a, key: 'copy.txt' };
  await manager.copy(a, other, { visibility: 'private', ifNoneMatch: false });
  assert.equal((await manager.stat(other)).visibility, 'private');
  assert.equal(await manager.delete(a), true);
  assert.equal(await manager.stat(a), null);
  await manager.close();
  assert.equal(client.closed, false);
});
test('S3 CloudFront/public URL generation and endpoint safety do not change access policy', async () => {
  /** Injected SDK-compatible fixture; it never creates a network connection. */
  const client = sdkClient();
  /** Explicit S3 wrapper under test; native client ownership is asserted. */
  const storage = createS3Storage({
    region: 'us-east-1',
    client,
    publicBaseUrl: 'https://cdn.example.net/assets',
  });
  /** Formatted CDN URL only; publicUrl never grants permission or fetches it. */
  const url = storage.publicUrl(addr);
  assert.equal(
    url,
    'https://cdn.example.net/assets/demo-bucket/pictures/example.webp'
  );
  assert.throws(
    () => createS3Storage({ publicBaseUrl: 'http://cdn.invalid' }),
    /HTTPS/
  );
  assert.throws(
    () =>
      createS3Storage({
        cloudFrontSigning: { keyPairId: 'abc', privateKey: 'abc' },
      }),
    /requires publicBaseUrl/
  );
  assert.throws(
    () => createS3Storage({ multipart: { partSize: 5, queueSize: 0 } }),
    /part size/
  );
  await storage.close();
  assert.equal(client.closed, false);
});
