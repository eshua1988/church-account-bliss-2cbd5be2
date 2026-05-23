import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface NotificationMetadata {
  transaction_id?: string;
  amount?: number;
  currency?: string;
  issued_to?: string;
  submitter_name?: string;
  department_name?: string;
  images_skipped?: boolean;
  pdf_path?: string;
  link_token?: string;
  [key: string]: unknown;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  metadata: NotificationMetadata | null;
  created_at: string;
}

export const useNotifications = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'denied'
  );
  const { user } = useAuth();
  const { toast } = useToast();

  const showBrowserNotification = useCallback(async (notification: Notification) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const title = notification.title || 'Новое уведомление';
    const body = notification.message || '';
    const options: NotificationOptions = {
      body,
      tag: notification.id,
      icon: `${import.meta.env.BASE_URL}Kosciol.ico.png`,
      badge: `${import.meta.env.BASE_URL}Kosciol.ico.png`,
      data: { notificationId: notification.id, url: window.location.href },
    };

    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(title, options);
      } else {
        new Notification(title, options);
      }
    } catch (error) {
      console.warn('Browser notification failed:', error);
    }
  }, []);

  const enablePushNotifications = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      toast({
        title: 'Push недоступен',
        description: 'Этот браузер не поддерживает уведомления.',
        variant: 'destructive',
      });
      return 'denied' as NotificationPermission;
    }

    const permission = await Notification.requestPermission();
    setPushPermission(permission);

    if (permission === 'granted') {
      toast({
        title: 'Push уведомления включены',
        description: 'Новые уведомления будут показываться на этом устройстве.',
      });
    } else {
      toast({
        title: 'Push уведомления не включены',
        description: 'Разрешите уведомления в настройках браузера.',
        variant: 'destructive',
      });
    }

    return permission;
  }, [toast]);

  const fetchNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(25);

      if (error) throw error;

      // Cast the data to our Notification type, ensuring metadata is correctly typed
      const typedNotifications: Notification[] = (data || []).map(n => ({
        ...n,
        metadata: n.metadata as NotificationMetadata | null,
      }));
      setNotifications(typedNotifications);
      setUnreadCount(typedNotifications.filter(n => !n.is_read).length);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  const markAsRead = useCallback(async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId);

      if (error) throw error;

      setNotifications(prev =>
        prev.map(n => (n.id === notificationId ? { ...n, is_read: true } : n))
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', user.id)
        .eq('is_read', false);

      if (error) throw error;

      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  }, [user]);

  const deleteNotification = useCallback(async (notificationId: string) => {
    try {
      const notification = notifications.find(n => n.id === notificationId);
      
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId);

      if (error) throw error;

      setNotifications(prev => prev.filter(n => n.id !== notificationId));
      if (notification && !notification.is_read) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  }, [notifications]);

  const clearAllNotifications = useCallback(async () => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('user_id', user.id);

      if (error) throw error;

      setNotifications([]);
      setUnreadCount(0);
    } catch (error) {
      console.error('Error clearing notifications:', error);
    }
  }, [user]);

  // Initial fetch
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Real-time subscription
  useEffect(() => {
    if (!user) return;

    // Unique channel name per user prevents multi-device conflicts
    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        async (payload) => {
          // Fetch full notification data including metadata (Realtime may not include JSONB fields)
          const { data: fullNotif } = await supabase
            .from('notifications')
            .select('*')
            .eq('id', payload.new.id)
            .single();

          const newNotification = (fullNotif || payload.new) as Notification;
          setNotifications(prev => [newNotification, ...prev.filter(n => n.id !== newNotification.id)]);
          setUnreadCount(prev => prev + 1);
          
          // Show toast for new notification
          toast({
            title: newNotification.title,
            description: newNotification.message,
          });
          showBrowserNotification(newNotification);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        async (payload) => {
          // Fetch fresh data because Realtime may not include JSONB fields in UPDATE payload
          const { data: updatedNotif } = await supabase
            .from('notifications')
            .select('*')
            .eq('id', payload.new.id)
            .single();
          if (updatedNotif) {
            setNotifications(prev =>
              prev.map(n => n.id === updatedNotif.id ? (updatedNotif as Notification) : n)
            );
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const deletedId = payload.old.id;
          setNotifications(prev => {
            const deleted = prev.find(n => n.id === deletedId);
            if (deleted && !deleted.is_read) {
              setUnreadCount(c => Math.max(0, c - 1));
            }
            return prev.filter(n => n.id !== deletedId);
          });
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('Realtime: notifications subscription issue, falling back to polling');
        }
      });

    // Polling fallback every 30s
    const poll = setInterval(() => fetchNotifications(), 30_000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [user, toast, fetchNotifications, showBrowserNotification]);

  return {
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAllNotifications,
    refetch: fetchNotifications,
    pushPermission,
    enablePushNotifications,
  };
};
