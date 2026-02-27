import { useState } from 'react';
import { Mail, Check, CheckCheck, Trash2, X, FileText, Download, Loader2 } from 'lucide-react';
import { useNotifications, Notification } from '@/hooks/useNotifications';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

const NotificationCard = ({
  notification,
  onMarkAsRead,
  onDelete,
}: {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const transactionId = notification.metadata?.transaction_id as string | undefined;
  const pdfPath = notification.metadata?.pdf_path as string | undefined;

  const handleDownloadPdf = async () => {
    if (!transactionId) return;
    setIsDownloading(true);
    try {
      // Try pdf_path from metadata first, then fallback to listing storage folder
      let filePath = pdfPath;

      if (!filePath) {
        // Find owner_user_id from the transaction via a storage listing heuristic
        // We'll use the notification user_id as the owner
        const userId = notification.user_id;
        const { data: files } = await supabase.storage
          .from('documents')
          .list(`${userId}/${transactionId}`);
        const pdfFile = files?.find(f => f.name.endsWith('.pdf'));
        if (pdfFile) {
          filePath = `${userId}/${transactionId}/${pdfFile.name}`;
        }
      }

      if (!filePath) {
        alert('PDF файл не найден');
        return;
      }

      const { data: urlData } = await supabase.storage
        .from('documents')
        .createSignedUrl(filePath, 60 * 60);

      if (urlData?.signedUrl) {
        window.open(urlData.signedUrl, '_blank');
      } else {
        alert('Не удалось получить ссылку на PDF');
      }
    } catch (e) {
      console.error('PDF download error:', e);
    } finally {
      setIsDownloading(false);
    }
  };

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
          {transactionId && (
            <div className="mt-3">
              <Button
                variant="default"
                size="sm"
                className="gap-2 h-8"
                onClick={handleDownloadPdf}
                disabled={isDownloading}
              >
                {isDownloading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {isDownloading ? 'Загрузка...' : 'Скачать PDF'}
              </Button>
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
