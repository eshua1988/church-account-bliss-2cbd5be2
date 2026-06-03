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

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
};

const getPushBasePath = () => import.meta.env.BASE_URL || '/';

const getPushAppUrl = () => new URL(getPushBasePath(), window.location.origin).toString();

const ensurePushServiceWorker = async () => {
  const scopePath = getPushBasePath();
  const scopeUrl = getPushAppUrl();
  const swUrl = new URL(`${scopePath.replace(/\/$/, '')}/sw.js`, window.location.origin).toString();
  const existingRegistration = await navigator.serviceWorker.getRegistration(scopeUrl);

  if (existingRegistration) {
    return existingRegistration;
  }

  return navigator.serviceWorker.register(swUrl, { scope: scopePath });
};

export const useNotifications = () => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [hasPushSubscription, setHasPushSubscription] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'denied'
  );
  const { user } = useAuth();
  const { toast } = useToast();

  const savePushSubscription = useCallback(async (subscription: PushSubscription) => {
    if (!user) return { ok: false, error: 'Пользователь не авторизован' };

    const subscriptionJson = subscription.toJSON();
    const endpoint = subscription.endpoint;
    const p256dh = subscriptionJson.keys?.p256dh;
    const auth = subscriptionJson.keys?.auth;

    if (!endpoint || !p256dh || !auth) {
      return { ok: false, error: 'Браузер не вернул ключи push-подписки' };
    }

    const metadata = {
      endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent,
      saved_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from('notifications')
      .select('id')
      .eq('user_id', user.id)
      .eq('type', 'push_subscription')
      .eq('message', endpoint)
      .limit(10);

    if (existing && existing.length > 0) {
      const [primary, ...duplicates] = existing;
      const { error: updateError } = await supabase
        .from('notifications')
        .update({
          is_read: true,
          metadata,
        })
        .eq('id', primary.id);

      if (duplicates.length > 0) {
        await supabase
          .from('notifications')
          .delete()
          .in('id', duplicates.map((row) => row.id));
      }

      if (updateError) {
        console.error('Push subscription update failed:', updateError);
        return { ok: false, error: updateError.message };
      }

      return { ok: true };
    }

    const { error } = await supabase
      .from('notifications')
      .insert({
        user_id: user.id,
        title: 'Push subscription',
        message: endpoint,
        type: 'push_subscription',
        is_read: true,
        metadata,
      });

    if (error) {
      console.error('Push subscription save failed:', error);
      return { ok: false, error: error.message };
    }

    return { ok: true };
  }, [user]);

  const sendTestPushNotification = useCallback(async (subscription: PushSubscription) => {
    if (!user) return;

    const { data, error } = await supabase.functions.invoke('send-push-notification', {
      body: {
        user_id: user.id,
        title: 'Push включён',
        message: 'Тестовое уведомление Church Accounting',
        url: getPushAppUrl(),
        endpoint: subscription.endpoint,
      },
    });

    if (error) {
      throw new Error(error.message || 'Тестовый push не отправлен');
    }

    if (!data || Number(data.sent || 0) < 1) {
      throw new Error('Сервер не нашёл активную push-подписку для этого устройства');
    }
  }, [user]);

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
        const registration = await ensurePushServiceWorker();
        await registration.showNotification(title, options);
      } else {
        new Notification(title, options);
      }
    } catch (error) {
      console.warn('Browser notification failed:', error);
    }
  }, []);

  const queueServerPushFallback = useCallback((notification: Notification) => {
    if (!user || typeof window === 'undefined') return;
    if (notification.metadata?.push_sent_at) return;

    window.setTimeout(async () => {
      try {
        const { data: latestNotification } = await supabase
          .from('notifications')
          .select('id, metadata')
          .eq('id', notification.id)
          .single();

        const metadata = latestNotification?.metadata as NotificationMetadata | null | undefined;
        if (metadata?.push_sent_at) return;

        await supabase.functions.invoke('send-push-notification', {
          body: {
            notification_id: notification.id,
            url: getPushAppUrl(),
          },
        });
      } catch (error) {
        console.warn('Push fallback failed:', error);
      }
    }, 2500);
  }, [user]);

  const enablePushNotifications = useCallback(async () => {
    {
      if (!user) return 'denied' as NotificationPermission;

      if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        toast({
          title: 'Push недоступен',
          description: 'Этот браузер не поддерживает push-уведомления.',
          variant: 'destructive',
        });
        return 'denied' as NotificationPermission;
      }

      const permission = await Notification.requestPermission();
      setPushPermission(permission);

      if (permission !== 'granted') {
        toast({
          title: 'Push уведомления не включены',
          description: 'Разрешите уведомления в настройках браузера.',
          variant: 'destructive',
        });
        return permission;
      }

      try {
        const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
        if (!vapidPublicKey) {
          toast({
            title: 'Push разрешен',
            description: 'Нужно добавить VAPID ключ для отправки push на устройство.',
            variant: 'destructive',
          });
          return permission;
        }

        const registration = await ensurePushServiceWorker();
        const existingSubscription = await registration.pushManager.getSubscription();
        const subscription = existingSubscription || await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        });
        const saved = await savePushSubscription(subscription);
        if (!saved.ok) throw new Error(saved.error || 'Could not save push subscription');

        setHasPushSubscription(true);
        await sendTestPushNotification(subscription);
        toast({
          title: 'Push уведомления включены',
          description: 'Новые уведомления будут приходить на это устройство.',
        });
      } catch (error) {
        console.error('Push subscription failed:', error);
        toast({
          title: 'Push не включился',
          description: 'Не удалось сохранить подписку устройства. Попробуйте еще раз.',
          variant: 'destructive',
        });
      }

      return permission;
    }

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
  }, [toast, user, savePushSubscription, sendTestPushNotification]);

  useEffect(() => {
    if (!user || typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;

    ensurePushServiceWorker()
      .then((registration) => registration.pushManager.getSubscription())
      .then(async (subscription) => {
        setHasPushSubscription(Boolean(subscription));
        if (subscription) {
          const saved = await savePushSubscription(subscription);
          setHasPushSubscription(saved.ok);
        }
      })
      .catch(() => setHasPushSubscription(false));
  }, [user, savePushSubscription]);

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
        .neq('type', 'push_subscription')
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
        .eq('is_read', false)
        .neq('type', 'push_subscription');

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
        .eq('user_id', user.id)
        .neq('type', 'push_subscription');

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
          if (newNotification.type === 'push_subscription') return;
          setNotifications(prev => [newNotification, ...prev.filter(n => n.id !== newNotification.id)]);
          setUnreadCount(prev => prev + 1);
          
          // Show toast for new notification
          toast({
            title: newNotification.title,
            description: newNotification.message,
          });
          showBrowserNotification(newNotification);
          queueServerPushFallback(newNotification);
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
  }, [user, toast, fetchNotifications, showBrowserNotification, queueServerPushFallback, hasPushSubscription]);

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
    hasPushSubscription,
    enablePushNotifications,
  };
};
