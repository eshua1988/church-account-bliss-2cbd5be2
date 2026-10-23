import { AwsClient } from "npm:aws4fetch@1.0.20";

const required = (name: string) => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing ${name} secret`);
  return value;
};

const encodeObjectPath = (path: string) => path
  .split('/')
  .filter(Boolean)
  .map(part => encodeURIComponent(part))
  .join('/');

export const isR2Configured = () => Boolean(
  Deno.env.get('R2_ENDPOINT') &&
  Deno.env.get('R2_BUCKET') &&
  Deno.env.get('R2_ACCESS_KEY_ID') &&
  Deno.env.get('R2_SECRET_ACCESS_KEY'),
);

/**
 * Produces a short-lived, object-specific R2 URL. The browser receives no R2
 * credentials and can only perform the requested operation on this one object.
 */
export const createR2SignedUrl = async (
  objectPath: string,
  method: 'GET' | 'PUT',
  options: { contentType?: string; expiresInSeconds?: number } = {},
) => {
  const endpoint = required('R2_ENDPOINT').replace(/\/$/, '');
  const bucket = required('R2_BUCKET');
  const client = new AwsClient({
    accessKeyId: required('R2_ACCESS_KEY_ID'),
    secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    service: 's3',
    region: 'auto',
  });
  // R2 expects the expiry as a query parameter before signing. Passing a
  // non-standard `expires` option to aws4fetch leaves its 24-hour default in
  // place and, with some paths, yields a SignatureDoesNotMatch response.
  const url = new URL(`${endpoint}/${bucket}/${encodeObjectPath(objectPath)}`);
  url.searchParams.set('X-Amz-Expires', String(
    Math.min(Math.max(options.expiresInSeconds ?? 900, 60), 3600),
  ));
  const request = await client.sign(new Request(url, {
    method,
    headers: options.contentType ? { 'content-type': options.contentType } : undefined,
  }), {
    aws: { signQuery: true },
  });
  return request.url;
};

export const downloadFromR2 = async (objectPath: string) => {
  const endpoint = required('R2_ENDPOINT').replace(/\/$/, '');
  const bucket = required('R2_BUCKET');
  const client = new AwsClient({
    accessKeyId: required('R2_ACCESS_KEY_ID'),
    secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    service: 's3',
    region: 'auto',
  });
  // Server-to-server signing uses an Authorization header instead of an URL
  // signature. This avoids browser-facing SignatureDoesNotMatch failures.
  const response = await client.fetch(`${endpoint}/${bucket}/${encodeObjectPath(objectPath)}`, {
    method: 'GET',
  });
  if (!response.ok) throw new Error(`R2 download failed: HTTP ${response.status}`);
  return response.blob();
};
