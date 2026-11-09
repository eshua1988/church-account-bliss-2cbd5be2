import JSZip from 'jszip';
import { supabase } from '@/integrations/supabase/client';
import { Notification } from '@/hooks/useNotifications';
import {
  CloudConnection,
  hasCloudCredentials,
  isCloudEnabledOnDevice,
  loadCloudConnections,
  renewGoogleDriveToken,
  saveCloudConnections,
  uploadCloudArchive,
} from '@/lib/cloudStorage';
import {
  getNotificationArchiveMonth,
  getNotificationArchiveYear,
} from '@/lib/archiveFolders';

const getPdfBlob = async (notification: Notification) => {
  let filePath = notification.metadata?.pdf_path as string | undefined;
  const transactionId = notification.metadata?.transaction_id as string | undefined;

  if (!filePath && transactionId) {
    const { data: files } = await supabase.storage
      .from('documents')
      .list(`${notification.user_id}/${transactionId}`);
    const pdf = files?.find(file => file.name.toLowerCase().endsWith('.pdf'));
    if (pdf) filePath = `${notification.user_id}/${transactionId}/${pdf.name}`;
  }
  if (!filePath) throw new Error(`PDF не найден: ${notification.id}`);

  const supabaseUrl = (supabase as any).supabaseUrl as string;
  const supabaseKey = (supabase as any).supabaseKey as string;
  // The Edge Function reads R2 first and falls back to legacy Supabase Storage.
  // Old archives have not been copied to R2 yet, so a direct R2 signed link
  // produces 404 even though the document still exists in Supabase.
  const params = new URLSearchParams({ action: 'download', filePath, userId: notification.user_id });
  const response = await fetch(
    `${supabaseUrl}/functions/v1/upload-payout-pdf?${params}`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } },
  );
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `PDF HTTP ${response.status}`);
  }
  return {
    blob: await response.blob(),
    name: filePath.split('/').pop() || `${notification.id}.pdf`,
  };
};

const mapWithConcurrency = async <T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) => {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const run = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
};

const CLOUD_BATCH_SIZE = 25;
const MAX_CLOUD_BATCHES_PER_SYNC = 2;
const withTimeout = async <T,>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => { timeout = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

export const syncNotificationArchivesToCloud = async (
  notifications: Notification[],
  connectionId?: string,
) => {
  const storedConnections = loadCloudConnections();
  const candidateConnections = connectionId
    ? storedConnections.filter(connection => connection.id === connectionId)
    : storedConnections;
  const connections: CloudConnection[] = [];
  const errors: string[] = [];

  for (const connection of candidateConnections) {
    if (!connection.enabled || !isCloudEnabledOnDevice(connection)) continue;
    if (connection.provider === 'google_drive' && !hasCloudCredentials(connection)) {
      try {
        const renewed = await renewGoogleDriveToken(connection);
        const index = storedConnections.findIndex(item => item.id === renewed.id);
        storedConnections[index] = renewed;
        connections.push(renewed);
      } catch (error) {
        errors.push(`${connection.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }
    if (hasCloudCredentials(connection)) connections.push(connection);
  }
  saveCloudConnections(storedConnections);
  if (connections.length === 0) {
    return { uploaded: 0, archives: 0, skipped: true, errors };
  }

  // Files are uploaded in small, immutable ZIP batches. This keeps a large
  // archive from being downloaded and compressed again on every sync.
  const archived = notifications.filter(notification => notification.metadata?.archived_at && !notification.metadata?.cloud_archive_synced_at);
  const groups = archived.reduce<Record<string, Notification[]>>((result, notification) => {
    const type = notification.metadata?.archive_type === 'income' ? 'income' : 'expense';
    const year = Number(notification.metadata?.archive_year) || getNotificationArchiveYear(notification);
    const key = `${year}-${type}`;
    (result[key] ||= []).push(notification);
    return result;
  }, {});

  const batches = Object.entries(groups).flatMap(([key, items]) =>
    Array.from({ length: Math.ceil(items.length / CLOUD_BATCH_SIZE) }, (_, index) => ({
      key,
      items: items.slice(index * CLOUD_BATCH_SIZE, (index + 1) * CLOUD_BATCH_SIZE),
    })),
  );
  let uploaded = 0;
  let processedBatches = 0;
  for (const { key, items } of batches.slice(0, MAX_CLOUD_BATCHES_PER_SYNC)) {
    const [year, type] = key.split('-');
    const folderName = `${year} ${type === 'income' ? 'доход' : 'расход'}`;
    const zip = new JSZip();
    const folder = zip.folder(folderName);
    if (!folder) continue;

    const downloads = await mapWithConcurrency(items, 2, async notification => {
      try {
        return await withTimeout(getPdfBlob(notification), 45_000, `Превышено время загрузки PDF: ${notification.id}`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        return null;
      }
    });
    const uploadedItems = items.filter((_, index) => Boolean(downloads[index]));
    for (let index = 0; index < items.length; index++) {
      const notification = items[index];
      const pdf = downloads[index];
      if (!pdf) continue;
      const monthFolder = folder.folder(getNotificationArchiveMonth(notification));
      monthFolder?.file(`${notification.id.slice(0, 8)}-${pdf.name}`, pdf.blob);
    }
    if (uploadedItems.length === 0) continue;

    const archive = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
    const fileName = `${folderName}-${getNotificationArchiveMonth(uploadedItems[0])}-${uploadedItems[0].id.slice(0, 8)}-${uploadedItems[uploadedItems.length - 1].id.slice(0, 8)}.zip`;

    const uploadResults = await Promise.allSettled(connections.map(connection => withTimeout(
      uploadCloudArchive(connection, fileName, archive),
      90_000,
      `${connection.name}: превышено время загрузки архива`,
    )));
    uploadResults.forEach((result, index) => {
      const connection = connections[index];
      if (result.status === 'fulfilled') {
        uploaded++;
      } else {
        errors.push(`${connection.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      }
    });
    if (uploadResults.every(result => result.status === 'fulfilled')) {
      const syncedAt = new Date().toISOString();
      await Promise.all(uploadedItems.map(notification => supabase.from('notifications').update({
        metadata: { ...(notification.metadata || {}), cloud_archive_synced_at: syncedAt },
      }).eq('id', notification.id)));
    }
    processedBatches++;
  }

  const remaining = Math.max(batches.length - processedBatches, 0);
  return { uploaded, archives: processedBatches, skipped: false, errors, pendingBatches: remaining };
};
