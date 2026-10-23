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
  const headers = options.contentType ? { 'content-type': options.contentType } : undefined;
  const request = await client.sign(`${endpoint}/${bucket}/${encodeObjectPath(objectPath)}`, {
    method,
    headers,
    aws: {
      signQuery: true,
      expires: Math.min(Math.max(options.expiresInSeconds ?? 900, 60), 3600),
    },
  });
  return request.url;
};

export const downloadFromR2 = async (objectPath: string) => {
  const url = await createR2SignedUrl(objectPath, 'GET');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`R2 download failed: HTTP ${response.status}`);
  return response.blob();
};
