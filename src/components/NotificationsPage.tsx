import { Mail, Check, CheckCheck, Trash2, X, FileDown } from 'lucide-react';
import { useNotifications, Notification } from '@/hooks/useNotifications';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';

const NotificationCard = ({
  notification,
  onMarkAsRead,
  onDelete,
}: {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
}) => {
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
          {notification.metadata?.pdf_url && (
            <a
              href={notification.metadata.pdf_url as string}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors text-sm font-medium"
              onClick={(e) => e.stopPropagation()}
            >
              <FileDown className="h-4 w-4" />
              Скачать PDF ордер
            </a>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            {formatDistanceToNow(new Date(notification.created_at), {
              addSuffix: true,
              locale: ru,
            })}
          </p>
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
