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

const getPdfBlob = async (notification: Notification, signal?: AbortSignal) => {
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
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }, signal },
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

const mapWithConcurrency = async <T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>, signal?: AbortSignal) => {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const run = async () => {
    while (nextIndex < items.length) {
      if (signal?.aborted) throw new DOMException('Синхронизация отменена', 'AbortError');
      const index = nextIndex++;
      results[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
};

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
  signal?: AbortSignal,
) => {
  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException('Синхронизация отменена', 'AbortError');
  };
  throwIfAborted();
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

  // A cloud archive is one ZIP per calendar year. Rebuild only years that have
  // new documents (or documents created by the former batch format), using all
  // documents of that year, then overwrite its ZIP with the same name.
  const archived = notifications.filter(notification => notification.metadata?.archived_at);
  const yearsToRebuild = new Set(archived
    .filter(notification => notification.metadata?.cloud_archive_format !== 'yearly-v1')
    .map(notification => String(Number(notification.metadata?.archive_year) || getNotificationArchiveYear(notification))));
  const groups = archived.reduce<Record<string, Notification[]>>((result, notification) => {
    const year = Number(notification.metadata?.archive_year) || getNotificationArchiveYear(notification);
    if (yearsToRebuild.has(String(year))) (result[String(year)] ||= []).push(notification);
    return result;
  }, {});

  let uploaded = 0;
  let processedArchives = 0;
  for (const [year, items] of Object.entries(groups)) {
    throwIfAborted();
    const zip = new JSZip();
    const folder = zip.folder(year);
    if (!folder) continue;

    const downloads = await mapWithConcurrency(items, 2, async notification => {
      try {
        return await withTimeout(getPdfBlob(notification, signal), 45_000, `Превышено время загрузки PDF: ${notification.id}`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        return null;
      }
    }, signal);
    throwIfAborted();
    // Do not replace an existing yearly archive with an incomplete one if a
    // document cannot be downloaded during this run.
    if (downloads.some(pdf => !pdf)) continue;
    for (let index = 0; index < items.length; index++) {
      const notification = items[index];
      const pdf = downloads[index];
      if (!pdf) continue;
      const typeFolder = folder.folder(notification.metadata?.archive_type === 'income' ? 'доход' : 'расход');
      const monthFolder = typeFolder?.folder(getNotificationArchiveMonth(notification));
      monthFolder?.file(`${notification.id.slice(0, 8)}-${pdf.name}`, pdf.blob);
    }

    const archive = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
    throwIfAborted();
    const fileName = `${year}.zip`;

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
    throwIfAborted();
    if (uploadResults.every(result => result.status === 'fulfilled')) {
      const syncedAt = new Date().toISOString();
      await Promise.all(items.map(notification => supabase.from('notifications').update({
        metadata: { ...(notification.metadata || {}), cloud_archive_synced_at: syncedAt, cloud_archive_format: 'yearly-v1' },
      }).eq('id', notification.id)));
    }
    processedArchives++;
  }

  return { uploaded, archives: processedArchives, skipped: false, errors, pendingBatches: 0 };
};
