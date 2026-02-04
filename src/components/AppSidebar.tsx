import { useState } from 'react';
import { Church, BarChart3, Settings, ChevronLeft, ChevronRight, Menu, FileText, Wallet } from 'lucide-react';
import { useTranslation } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';

interface AppSidebarProps {
  activeTab: 'balance' | 'statistics' | 'payout' | 'settings';
  onTabChange: (tab: 'balance' | 'statistics' | 'payout' | 'settings') => void;
}

export const AppSidebar = ({ activeTab, onTabChange }: AppSidebarProps) => {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
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
      setMobileOpen(false);
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
      {/* Logo area with title */}
      <div className="border-b border-border px-3 py-4">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl gradient-primary shadow-glow flex items-center justify-center flex-shrink-0">
            <Church className="w-5 h-5 text-primary-foreground" />
          </div>
          {(isSheet || !collapsed) && (
            <div className="min-w-0">
              <h1 className="font-bold text-foreground text-sm leading-tight">{t('appTitle')}</h1>
              <p className="text-muted-foreground text-xs leading-tight truncate">{t('appSubtitle')}</p>
            </div>
          )}
        </div>
      </div>

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

      {/* Collapse toggle - only for desktop */}
      {!isSheet && (
        <div className="p-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed(!collapsed)}
            className="w-full flex items-center justify-center"
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </Button>
        </div>
      )}
    </div>
  );

  // Mobile: use Sheet
  if (isMobile) {
    return (
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="fixed left-4 top-4 z-50 bg-card shadow-md border-border"
          >
            <Menu className="w-5 h-5" />
          </Button>
        </SheetTrigger>
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
        'sticky left-0 top-0 z-40 h-screen bg-card border-r border-border transition-all duration-300 flex flex-col flex-shrink-0',
        collapsed ? 'w-16' : 'w-56'
      )}
    >
      <SidebarContent />
    </aside>
  );
};
