import { Notification } from '@/hooks/useNotifications';

const MONTH_NAMES = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
] as const;

const normalizeDate = (value: unknown) => {
  const text = String(value || '').trim();
  const match = text.match(/(20\d{2})[-./](\d{2})[-./](\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day, iso: `${match[1]}-${match[2]}-${match[3]}` };
};

/**
 * Returns the document date stored when the PDF was generated. Multi-receipt
 * deposit PDFs deliberately use the first receipt, matching the first table
 * visible in the document.
 */
export const getNotificationDocumentDate = (notification: Notification) => {
  const metadata = notification.metadata || {};
  const receipts = Array.isArray(metadata.receipts)
    ? metadata.receipts as Array<Record<string, unknown>>
    : [];
  const firstReceiptDate = receipts.length > 0 ? receipts[0]?.date : undefined;
  const pdfPath = String(metadata.pdf_path || '');
  const filenameDate = pdfPath.match(/20\d{2}-\d{2}-\d{2}/)?.[0];

  return normalizeDate(firstReceiptDate)
    || normalizeDate(metadata.date)
    || normalizeDate(filenameDate)
    || normalizeDate(notification.created_at)
    || { year: new Date().getFullYear(), month: 1, day: 1, iso: `${new Date().getFullYear()}-01-01` };
};

export const getNotificationArchiveYear = (notification: Notification) =>
  getNotificationDocumentDate(notification).year;

export const getNotificationArchiveMonth = (notification: Notification) =>
  MONTH_NAMES[getNotificationDocumentDate(notification).month - 1];

