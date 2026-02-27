import { useState, useCallback } from 'react';
import { Mail, Check, CheckCheck, Trash2, X, FileDown, Loader2, ChevronDown } from 'lucide-react';
import { useNotifications, Notification } from '@/hooks/useNotifications';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { openPdfUrl } from '@/lib/pdfDownload';

const NotificationCard = ({
  notification,
  onMarkAsRead,
  onDelete,
}: {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
}) => {
  const [downloading, setDownloading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleDownloadPdf = useCallback(async () => {
    const meta = notification.metadata;
    if (!meta) return;

    setDownloading(true);
    try {
      const pdfPath = meta.pdf_path as string | undefined;
      if (pdfPath) {
        const { data } = await supabase.storage
          .from('documents')
          .createSignedUrl(pdfPath, 3600);
        if (data?.signedUrl) {
          openPdfUrl(data.signedUrl);
          return;
        }
      }
      const pdfUrl = meta.pdf_url as string | undefined;
      if (pdfUrl) {
        openPdfUrl(pdfUrl);
      }
    } catch (e) {
      console.error('Download failed:', e);
    } finally {
      setDownloading(false);
    }
  }, [notification.metadata]);

  const hasPdf = notification.metadata?.pdf_path || notification.metadata?.pdf_url;

  return (
    <div
      className={cn(
        'p-4 sm:p-5 rounded-xl border border-border transition-all duration-200 hover:shadow-md',
        !notification.is_read
          ? 'bg-primary/5 border-primary/20'
          : 'bg-card'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {!notification.is_read && (
              <div className="w-2.5 h-2.5 rounded-full bg-primary flex-shrink-0" />
            )}
            <p className="font-semibold text-foreground">{notification.title}</p>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {notification.message}
          </p>
          <p className="text-xs text-muted-foreground mt-3">
            {format(new Date(notification.created_at), 'dd.MM.yyyy HH:mm')}
          </p>
          {hasPdf && (
            <div className="mt-2">
              <button
                onClick={() => setExpanded(v => !v)}
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
              >
                <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', expanded && 'rotate-180')} />
                {expanded ? 'Скрыть файл' : 'Показать файл PDF'}
              </button>
              {expanded && (
                <div className="mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={handleDownloadPdf}
                    disabled={downloading}
                  >
                    {downloading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileDown className="h-4 w-4" />
                    )}
                    Скачать PDF ордер
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!notification.is_read && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onMarkAsRead(notification.id)}
              title="Отметить как прочитанное"
            >
              <Check className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => onDelete(notification.id)}
            title="Удалить"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export const NotificationsPage = () => {
  const {
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAllNotifications,
  } = useNotifications();

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Mail className="h-6 w-6 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">
            Уведомления
            {unreadCount > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({unreadCount} непрочитанных)
              </span>
            )}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={markAllAsRead}
            >
              <CheckCheck className="h-4 w-4 mr-2" />
              Прочитать все
            </Button>
          )}
          {notifications.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={clearAllNotifications}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Очистить
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-muted-foreground">
          Загрузка...
        </div>
      ) : notifications.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground">
          <Mail className="h-16 w-16 mx-auto mb-4 opacity-30" />
          <p className="text-lg">Нет уведомлений</p>
          <p className="text-sm mt-1">Здесь будут отображаться уведомления о новых расходных ордерах</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              onMarkAsRead={markAsRead}
              onDelete={deleteNotification}
            />
          ))}
          <p className="text-xs text-center text-muted-foreground pt-2">
            Отображается до 25 последних уведомлений
          </p>
        </div>
      )}
    </div>
  );
};
