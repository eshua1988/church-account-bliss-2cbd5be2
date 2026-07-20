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
  const params = new URLSearchParams({ action: 'sign', filePath, userId: notification.user_id });
  const signedResponse = await fetch(
    `${supabaseUrl}/functions/v1/upload-payout-pdf?${params}`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } },
  );
  const signed = await signedResponse.json();
  if (!signed.signedUrl) throw new Error(signed.error || 'Не удалось получить ссылку на PDF');

  const response = await fetch(signed.signedUrl);
  if (!response.ok) throw new Error(`PDF HTTP ${response.status}`);
  return {
    blob: await response.blob(),
    name: filePath.split('/').pop() || `${notification.id}.pdf`,
  };
};

export const syncNotificationArchivesToCloud = async (notifications: Notification[]) => {
  const storedConnections = loadCloudConnections();
  const connections: CloudConnection[] = [];
  const errors: string[] = [];

  for (const connection of storedConnections) {
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

  const archived = notifications.filter(notification => notification.metadata?.archived_at);
  const groups = archived.reduce<Record<string, Notification[]>>((result, notification) => {
    const type = notification.metadata?.archive_type === 'income' ? 'income' : 'expense';
    const year = Number(notification.metadata?.archive_year) || getNotificationArchiveYear(notification);
    const key = `${year}-${type}`;
    (result[key] ||= []).push(notification);
    return result;
  }, {});

  let uploaded = 0;
  for (const [key, items] of Object.entries(groups)) {
    const [year, type] = key.split('-');
    const folderName = `${year} ${type === 'income' ? 'доход' : 'расход'}`;
    const zip = new JSZip();
    const folder = zip.folder(folderName);
    if (!folder) continue;

    for (const notification of items) {
      const pdf = await getPdfBlob(notification);
      const monthFolder = folder.folder(getNotificationArchiveMonth(notification));
      monthFolder?.file(`${notification.id.slice(0, 8)}-${pdf.name}`, pdf.blob);
    }

    const archive = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });
    const fileName = `${folderName}.zip`;

    for (const connection of connections) {
      try {
        await uploadCloudArchive(connection, fileName, archive);
        uploaded++;
      } catch (error) {
        errors.push(`${connection.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return { uploaded, archives: Object.keys(groups).length, skipped: false, errors };
};
