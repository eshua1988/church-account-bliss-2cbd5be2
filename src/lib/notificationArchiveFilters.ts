import type { Notification } from '@/hooks/useNotifications';

export const getArchivedNotifications = (notifications: Notification[]) =>
  notifications.filter(notification => Boolean(notification.metadata?.archived_at));
