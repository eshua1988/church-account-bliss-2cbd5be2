import { BarChart3, Settings, FileText, Wallet, LogOut, RefreshCw } from 'lucide-react';
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

interface AppSidebarProps {
  activeTab: 'balance' | 'statistics' | 'payout' | 'settings';
  onTabChange: (tab: 'balance' | 'statistics' | 'payout' | 'settings') => void;
  collapsed: boolean;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  onSync?: () => void;
  isSyncing?: boolean;
}

export const AppSidebar = ({ 
  activeTab, 
  onTabChange, 
  collapsed, 
  mobileOpen, 
  onMobileOpenChange, 
  onSync,
  isSyncing,
}: AppSidebarProps) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { user, signOut } = useAuth();
  const { toast } = useToast();

  const menuItems = [
    { id: 'balance' as const, icon: Wallet, label: t('balanceByCurrency') },
    { id: 'statistics' as const, icon: BarChart3, label: t('statistics') },
    { id: 'payout' as const, icon: FileText, label: t('payoutGenerator') },
    { id: 'settings' as const, icon: Settings, label: t('settings') },
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

  const getInitials = () => {
    const email = user?.email || '';
    return email.substring(0, 2).toUpperCase();
  };

  const MenuButton = ({ item }: { item: typeof menuItems[0] }) => (
    <button
      onClick={() => handleTabChange(item.id)}
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

  const UserProfile = ({ showText = true }: { showText?: boolean }) => (
    <div className={cn(
      'flex items-center gap-3 px-4 py-3',
      !showText && 'justify-center px-2'
    )}>
      <Avatar className="h-10 w-10 flex-shrink-0">
        <AvatarFallback className="gradient-primary text-primary-foreground text-sm">
          {getInitials()}
        </AvatarFallback>
      </Avatar>
      {showText && (
        <div className="flex flex-col min-w-0">
          <p className="text-sm font-medium leading-none truncate">
            {user?.user_metadata?.display_name || 'Пользователь'}
          </p>
          <p className="text-xs leading-none text-muted-foreground truncate mt-1">
            {user?.email}
          </p>
        </div>
      )}
    </div>
  );

  const SyncButton = ({ showText = true }: { showText?: boolean }) => {
    if (!showText) {
      return (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="w-full"
              onClick={onSync}
              disabled={isSyncing}
            >
              <RefreshCw className={cn("w-5 h-5", isSyncing && "animate-spin")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            {isSyncing ? 'Синхронизация...' : 'Синхронизация'}
          </TooltipContent>
        </Tooltip>
      );
    }

    return (
      <Button
        variant="ghost"
        className="w-full justify-start gap-3 px-4 py-3 h-auto"
        onClick={onSync}
        disabled={isSyncing}
      >
        <RefreshCw className={cn("w-5 h-5 flex-shrink-0", isSyncing && "animate-spin")} />
        <span className="font-medium">{isSyncing ? 'Синхронизация...' : 'Синхронизация'}</span>
      </Button>
    );
  };

  const BottomActions = ({ showText = true }: { showText?: boolean }) => (
    <div className="border-t border-border px-2 py-3 space-y-2">
      {/* Google Sheets Sync Button */}
      <SyncButton showText={showText} />

      {/* Logout Button */}
      {showText ? (
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 px-4 py-3 h-auto text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={handleSignOut}
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          <span className="font-medium">Выйти</span>
        </Button>
      ) : (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={handleSignOut}
            >
              <LogOut className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            Выйти
          </TooltipContent>
        </Tooltip>
      )}
    </div>
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
                  <Avatar className="h-10 w-10">
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
                <MenuButton item={item} />
              ) : (
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleTabChange(item.id)}
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
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={10}>
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              )}
            </li>
          ))}
        </ul>
      </nav>

      {/* Bottom actions */}
      <BottomActions showText={isSheet || !collapsed} />
    </div>
  );

  // Mobile: use Sheet
  if (isMobile) {
    return (
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent 
          side="left" 
          className="w-72 p-0 bg-card border-r border-border"
        >
          <SidebarContent isSheet />
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: regular sidebar
  return (
    <aside
      className={cn(
        'bg-card border-r border-border transition-all duration-300 flex flex-col flex-shrink-0',
        collapsed ? 'w-16' : 'w-56'
      )}
    >
      <SidebarContent />
    </aside>
  );
};
