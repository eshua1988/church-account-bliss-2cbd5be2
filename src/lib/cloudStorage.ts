export type CloudProvider = 'google_drive' | 'onedrive' | 'dropbox' | 'webdav';

export interface CloudConnection {
  id: string;
  name: string;
  provider: CloudProvider;
  enabled: boolean;
  clientId?: string;
  accessToken?: string;
  folderId?: string;
  folderUrl?: string;
  folderPath?: string;
  baseUrl?: string;
  username?: string;
  password?: string;
}

export const CLOUD_CONNECTIONS_KEY = 'church-account-cloud-connections-v1';

export const CLOUD_PROVIDER_LABELS: Record<CloudProvider, string> = {
  google_drive: 'Google Drive',
  onedrive: 'Microsoft OneDrive',
  dropbox: 'Dropbox',
  webdav: 'WebDAV / Nextcloud',
};

export const loadCloudConnections = (): CloudConnection[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(CLOUD_CONNECTIONS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveCloudConnections = (connections: CloudConnection[]) => {
  localStorage.setItem(CLOUD_CONNECTIONS_KEY, JSON.stringify(connections));
  window.dispatchEvent(new CustomEvent('cloud-connections-changed'));
};

const joinPath = (...parts: Array<string | undefined>) =>
  parts.filter(Boolean).map(part => String(part).replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');

const getGoogleFolderId = (connection: CloudConnection) => {
  const url = connection.folderUrl?.trim();
  if (url) {
    const fromUrl = url.match(/\/folders\/([a-zA-Z0-9_-]+)/)?.[1] ||
      new URL(url).searchParams.get('id');
    if (fromUrl) return fromUrl;
  }
  const manualId = connection.folderId?.trim() || '';
  return /^[a-zA-Z0-9_-]+$/.test(manualId) ? manualId : '';
};

const getOneDriveShareId = (url: string) =>
  `u!${btoa(unescape(encodeURIComponent(url))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;

const uploadGoogleDrive = async (connection: CloudConnection, fileName: string, blob: Blob) => {
  const token = connection.accessToken?.trim();
  if (!token) throw new Error('Не указан Google Drive access token');
  const folderId = getGoogleFolderId(connection);
  const escapedName = fileName.replace(/'/g, "\\'");
  const folderQuery = folderId ? ` and '${folderId}' in parents` : '';
  const query = encodeURIComponent(`name='${escapedName}' and trashed=false${folderQuery}`);
  const list = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!list.ok) {
    if (list.status === 401) {
      throw new Error('Google Drive: авторизация истекла или недействительна. Нажмите «Подключить Google Drive»');
    }
    throw new Error(`Google Drive: HTTP ${list.status}`);
  }
  const existing = (await list.json()).files?.[0]?.id;

  if (existing) {
    const update = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existing}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/zip' },
      body: blob,
    });
    if (!update.ok) throw new Error(`Google Drive: HTTP ${update.status}`);
    return;
  }

  const boundary = `codex-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name: fileName,
    mimeType: 'application/zip',
    ...(folderId ? { parents: [folderId] } : {}),
  });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: application/zip\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ]);
  const create = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!create.ok) throw new Error(`Google Drive: HTTP ${create.status}`);
};

const uploadOneDrive = async (connection: CloudConnection, fileName: string, blob: Blob) => {
  if (!connection.accessToken?.trim()) throw new Error('Не указан OneDrive access token');
  const sharedUrl = connection.folderUrl?.trim();
  const path = joinPath(connection.folderPath, fileName);
  const endpoint = sharedUrl
    ? `https://graph.microsoft.com/v1.0/shares/${getOneDriveShareId(sharedUrl)}/driveItem:/${encodeURI(fileName)}:/content`
    : `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURI(path)}:/content`;
  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${connection.accessToken}`, 'Content-Type': 'application/zip' },
    body: blob,
  });
  if (!response.ok) throw new Error(`OneDrive: HTTP ${response.status}`);
};

const uploadDropbox = async (connection: CloudConnection, fileName: string, blob: Blob) => {
  if (!connection.accessToken?.trim()) throw new Error('Не указан Dropbox access token');
  const path = `/${joinPath(connection.folderPath, fileName)}`;
  const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', autorename: false, mute: true }),
    },
    body: blob,
  });
  if (!response.ok) throw new Error(`Dropbox: HTTP ${response.status}`);
};

const uploadWebDav = async (connection: CloudConnection, fileName: string, blob: Blob) => {
  if (!connection.baseUrl?.trim()) throw new Error('Не указан WebDAV URL');
  const auth = btoa(`${connection.username || ''}:${connection.password || ''}`);
  const url = `${connection.baseUrl.replace(/\/+$/, '')}/${joinPath(connection.folderPath, fileName)}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/zip' },
    body: blob,
  });
  if (!response.ok) throw new Error(`WebDAV: HTTP ${response.status}`);
};

export const uploadCloudArchive = async (
  connection: CloudConnection,
  fileName: string,
  blob: Blob,
) => {
  if (connection.provider === 'google_drive') return uploadGoogleDrive(connection, fileName, blob);
  if (connection.provider === 'onedrive') return uploadOneDrive(connection, fileName, blob);
  if (connection.provider === 'dropbox') return uploadDropbox(connection, fileName, blob);
  return uploadWebDav(connection, fileName, blob);
};
