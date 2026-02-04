import { BarChart3, Settings, FileText, Wallet } from 'lucide-react';
import { useTranslation } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';

interface AppSidebarProps {
  activeTab: 'balance' | 'statistics' | 'payout' | 'settings';
  onTabChange: (tab: 'balance' | 'statistics' | 'payout' | 'settings') => void;
  collapsed: boolean;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

export const AppSidebar = ({ activeTab, onTabChange, collapsed, mobileOpen, onMobileOpenChange }: AppSidebarProps) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();

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

  const SidebarContent = ({ isSheet = false }: { isSheet?: boolean }) => (
    <div className="flex flex-col h-full bg-card">
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
