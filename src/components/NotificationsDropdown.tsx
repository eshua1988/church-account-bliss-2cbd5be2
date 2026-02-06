import { Mail, Check, CheckCheck, Trash2, X } from 'lucide-react';
import { useNotifications, Notification } from '@/hooks/useNotifications';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';

interface NotificationsDropdownProps {
  collapsed?: boolean;
}

const NotificationItem = ({
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
        'p-3 border-b border-border last:border-b-0 hover:bg-accent/50 transition-colors',
        !notification.is_read && 'bg-primary/5'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {!notification.is_read && (
              <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
            )}
            <p className="font-medium text-sm truncate">{notification.title}</p>
          </div>
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
            {notification.message}
          </p>
          <p className="text-xs text-muted-foreground mt-2">
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
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation();
                onMarkAsRead(notification.id);
              }}
              title="Отметить как прочитанное"
            >
              <Check className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(notification.id);
            }}
            title="Удалить"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export const NotificationsDropdown = ({ collapsed = false }: NotificationsDropdownProps) => {
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200',
            'hover:bg-primary/10 text-foreground relative',
            collapsed && 'justify-center px-2'
          )}
        >
          <div className="relative">
            <Mail className="w-5 h-5 flex-shrink-0" />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
          {!collapsed && <span className="font-medium">Уведомления</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-80"
        align={collapsed ? 'center' : 'start'}
        side={collapsed ? 'right' : 'bottom'}
        sideOffset={collapsed ? 10 : 5}
      >
        <div className="flex items-center justify-between p-3 border-b border-border">
          <h3 className="font-semibold">Уведомления</h3>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={markAllAsRead}
                title="Прочитать все"
              >
                <CheckCheck className="h-4 w-4 mr-1" />
                Все
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-destructive hover:text-destructive"
                onClick={clearAllNotifications}
                title="Очистить все"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        <ScrollArea className="max-h-[400px]">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              Загрузка...
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Mail className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>Нет уведомлений</p>
            </div>
          ) : (
            notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkAsRead={markAsRead}
                onDelete={deleteNotification}
              />
            ))
          )}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
