import { BarChart3, Settings, FileText, Wallet, LogOut, RefreshCw, Key, Mail, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { NotificationsDropdown } from '@/components/NotificationsDropdown';

interface AppSidebarProps {
  activeTab: 'balance' | 'statistics' | 'payout' | 'settings';
  onTabChange: (tab: 'balance' | 'statistics' | 'payout' | 'settings') => void;
  collapsed: boolean;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  onSync?: () => void;
  isSyncing?: boolean;
  spreadsheetId?: string;
}

export const AppSidebar = ({ 
  activeTab, 
  onTabChange, 
  collapsed, 
  mobileOpen, 
  onMobileOpenChange, 
  onSync,
  isSyncing,
  spreadsheetId,
}: AppSidebarProps) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const menuItems = [
    { id: 'balance' as const, icon: Wallet, label: t('balanceByCurrency') },
    { id: 'statistics' as const, icon: BarChart3, label: t('statistics') },
    { id: 'settings' as const, icon: Settings, label: t('settings') },
    { id: 'notifications' as const, icon: Mail, label: 'Уведомления', isNotifications: true },
    { id: 'sync' as const, icon: RefreshCw, label: 'Синхронизация', isSync: true },
    { id: 'openSheet' as const, icon: ExternalLink, label: 'Google Таблица', isOpenSheet: true },
    { id: 'payout' as const, icon: FileText, label: t('payoutGenerator') },
  ];

  const handleTabChange = (tab: 'balance' | 'statistics' | 'payout' | 'settings') => {
    onTabChange(tab);
    if (isMobile) {
      onMobileOpenChange(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    toast({
      title: 'Выход выполнен',
      description: 'Вы вышли из системы',
    });
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast({
        title: 'Ошибка',
        description: 'Пароли не совпадают',
        variant: 'destructive',
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: 'Ошибка',
        description: 'Пароль должен содержать минимум 6 символов',
        variant: 'destructive',
      });
      return;
    }

    setIsChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      
      toast({
        title: 'Успешно',
        description: 'Пароль успешно изменён',
      });
      setPasswordDialogOpen(false);
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось изменить пароль',
        variant: 'destructive',
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const getInitials = () => {
    const email = user?.email || '';
    return email.substring(0, 2).toUpperCase();
  };

  const handleSyncClick = () => {
    if (onSync && !isSyncing) {
      onSync();
    }
    if (isMobile) {
      onMobileOpenChange(false);
    }
  };

  const handleOpenSheet = () => {
    if (spreadsheetId) {
      window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`, '_blank');
    } else {
      toast({
        title: 'Таблица не настроена',
        description: 'Укажите ID Google таблицы в настройках',
        variant: 'destructive',
      });
    }
    if (isMobile) {
      onMobileOpenChange(false);
    }
  };

  const MenuButton = ({ item, isSheet = false }: { item: typeof menuItems[0]; isSheet?: boolean }) => {
    if (item.isNotifications) {
      return <NotificationsDropdown collapsed={!isSheet && collapsed} />;
    }

    if (item.isSync) {
      return (
        <button
          onClick={handleSyncClick}
          disabled={isSyncing}
          className={cn(
            'w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200',
            'hover:bg-primary/10 text-foreground',
            isSyncing && 'opacity-50 cursor-not-allowed'
          )}
        >
          <item.icon className={cn("w-5 h-5 flex-shrink-0", isSyncing && "animate-spin")} />
          <span className="font-medium">{isSyncing ? 'Синхронизация...' : item.label}</span>
        </button>
      );
    }

    if (item.isOpenSheet) {
      return (
        <button
          onClick={handleOpenSheet}
          className={cn(
            'w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200',
            'hover:bg-primary/10 text-foreground'
          )}
        >
          <item.icon className="w-5 h-5 flex-shrink-0" />
          <span className="font-medium">{item.label}</span>
        </button>
      );
    }

    return (
      <button
        onClick={() => handleTabChange(item.id as 'balance' | 'statistics' | 'payout' | 'settings')}
        className={cn(
          'w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200',
          'hover:bg-primary/10',
          activeTab === item.id
            ? 'bg-primary text-primary-foreground shadow-glow'
            : 'text-foreground'
        )}
      >
        <item.icon className="w-5 h-5 flex-shrink-0" />
        <span className="font-medium">{item.label}</span>
      </button>
    );
  };

  const UserProfile = ({ showText = true }: { showText?: boolean }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={cn(
          'flex items-center gap-3 px-4 py-3 w-full hover:bg-accent/50 transition-colors rounded-lg',
          !showText && 'justify-center px-2'
        )}>
          <Avatar className="h-10 w-10 flex-shrink-0">
            <AvatarFallback className="gradient-primary text-primary-foreground text-sm">
              {getInitials()}
            </AvatarFallback>
          </Avatar>
          {showText && (
            <div className="flex flex-col min-w-0 text-left">
              <p className="text-sm font-medium leading-none truncate">
                {user?.user_metadata?.display_name || 'Пользователь'}
              </p>
              <p className="text-xs leading-none text-muted-foreground truncate mt-1">
                {user?.email}
              </p>
            </div>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start" side={showText ? "bottom" : "right"}>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">
              {user?.user_metadata?.display_name || 'Пользователь'}
            </p>
            <p className="text-xs leading-none text-muted-foreground">
              {user?.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setPasswordDialogOpen(true)}>
          <Key className="mr-2 h-4 w-4" />
          <span>Сменить пароль</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          <span>Выйти</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const SidebarContent = ({ isSheet = false }: { isSheet?: boolean }) => (
    <div className="flex flex-col h-full bg-card">
      {/* User Profile at top */}
      {user && (
        <div className="border-b border-border">
          {isSheet || !collapsed ? (
            <UserProfile showText />
          ) : (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <div className="flex justify-center py-3">
                  <Avatar className="h-10 w-10 cursor-pointer">
                    <AvatarFallback className="gradient-primary text-primary-foreground text-sm">
                      {getInitials()}
                    </AvatarFallback>
                  </Avatar>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={10}>
                <div>
                  <p className="font-medium">{user?.user_metadata?.display_name || 'Пользователь'}</p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                </div>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      {/* Menu items */}
      <nav className="flex-1 py-4 px-2">
        <ul className="space-y-2">
          {menuItems.map((item) => (
            <li key={item.id}>
              {isSheet || !collapsed ? (
                <MenuButton item={item} isSheet={isSheet} />
              ) : item.isNotifications ? (
                <NotificationsDropdown collapsed />
              ) : item.isOpenSheet ? (
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleOpenSheet}
                      className={cn(
                        'w-full flex items-center justify-center p-3 rounded-lg transition-all duration-200',
                        'hover:bg-primary/10 text-foreground'
                      )}
                    >
                      <item.icon className="w-5 h-5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={10}>
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    {item.isSync ? (
                      <button
                        onClick={handleSyncClick}
                        disabled={isSyncing}
                        className={cn(
                          'w-full flex items-center justify-center p-3 rounded-lg transition-all duration-200',
                          'hover:bg-primary/10 text-foreground',
                          isSyncing && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        <item.icon className={cn("w-5 h-5", isSyncing && "animate-spin")} />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleTabChange(item.id as 'balance' | 'statistics' | 'payout' | 'settings')}
                        className={cn(
                          'w-full flex items-center justify-center p-3 rounded-lg transition-all duration-200',
                          'hover:bg-primary/10',
                          activeTab === item.id
                            ? 'bg-primary text-primary-foreground shadow-glow'
                            : 'text-foreground'
                        )}
                      >
                        <item.icon className="w-5 h-5" />
                      </button>
                    )}
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={10}>
                    {item.isSync ? (isSyncing ? 'Синхронизация...' : item.label) : item.label}
                  </TooltipContent>
                </Tooltip>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );

  // Mobile: use Sheet
  if (isMobile) {
    return (
      <>
        <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
          <SheetContent 
            side="left" 
            className="w-72 p-0 bg-card border-r border-border"
          >
            <SidebarContent isSheet />
          </SheetContent>
        </Sheet>

        {/* Password Change Dialog */}
        <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Сменить пароль</DialogTitle>
              <DialogDescription>
                Введите новый пароль для вашей учётной записи
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">Новый пароль</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Минимум 6 символов"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Подтвердите пароль</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Повторите пароль"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPasswordDialogOpen(false)}>
                Отмена
              </Button>
              <Button onClick={handleChangePassword} disabled={isChangingPassword}>
                {isChangingPassword ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Desktop: regular sidebar
  return (
    <>
      <aside
        className={cn(
          'bg-card border-r border-border transition-all duration-300 flex flex-col flex-shrink-0',
          collapsed ? 'w-16' : 'w-56'
        )}
      >
        <SidebarContent />
      </aside>

      {/* Password Change Dialog */}
      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Сменить пароль</DialogTitle>
            <DialogDescription>
              Введите новый пароль для вашей учётной записи
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-password-desktop">Новый пароль</Label>
              <Input
                id="new-password-desktop"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Минимум 6 символов"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password-desktop">Подтвердите пароль</Label>
              <Input
                id="confirm-password-desktop"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Повторите пароль"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleChangePassword} disabled={isChangingPassword}>
              {isChangingPassword ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};