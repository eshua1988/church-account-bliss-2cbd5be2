import { useState } from 'react';
import { Wallet, BarChart3, Settings, ChevronLeft, ChevronRight, Menu, X } from 'lucide-react';
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
  activeTab: 'balance' | 'statistics' | 'settings';
  onTabChange: (tab: 'balance' | 'statistics' | 'settings') => void;
}

export const AppSidebar = ({ activeTab, onTabChange }: AppSidebarProps) => {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();

  const menuItems = [
    { id: 'balance' as const, icon: Wallet, label: t('balanceByCurrency') },
    { id: 'statistics' as const, icon: BarChart3, label: t('statistics') },
    { id: 'settings' as const, icon: Settings, label: t('settings') },
  ];

  const handleTabChange = (tab: 'balance' | 'statistics' | 'settings') => {
    onTabChange(tab);
    if (isMobile) {
      setMobileOpen(false);
    }
  };

  const SidebarContent = ({ isSheet = false }: { isSheet?: boolean }) => (
    <div className={cn(
      'flex flex-col h-full',
      isSheet ? 'w-full' : ''
    )}>
      {/* Logo area */}
      <div className="h-16 flex items-center justify-center border-b border-sidebar-border">
        <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center">
          <Wallet className="w-5 h-5 text-primary-foreground" />
        </div>
      </div>

      {/* Menu items */}
      <nav className="flex-1 py-4">
        <ul className="space-y-2 px-2">
          {menuItems.map((item) => (
            <li key={item.id}>
              {isSheet || !collapsed ? (
                <button
                  onClick={() => handleTabChange(item.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200',
                    'hover:bg-sidebar-accent',
                    activeTab === item.id
                      ? 'bg-primary text-primary-foreground shadow-glow'
                      : 'text-sidebar-foreground'
                  )}
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  <span className="font-medium truncate">{item.label}</span>
                </button>
              ) : (
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => handleTabChange(item.id)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200',
                        'hover:bg-sidebar-accent',
                        activeTab === item.id
                          ? 'bg-primary text-primary-foreground shadow-glow'
                          : 'text-sidebar-foreground'
                      )}
                    >
                      <item.icon className="w-5 h-5 flex-shrink-0" />
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
        <div className="p-2 border-t border-sidebar-border">
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
            variant="ghost"
            size="icon"
            className="fixed left-4 top-4 z-50 bg-background/80 backdrop-blur-sm shadow-md"
          >
            <Menu className="w-5 h-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0 bg-sidebar-background">
          <SidebarContent isSheet />
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: regular sidebar
  return (
    <aside
      className={cn(
        'sticky left-0 top-0 z-40 h-screen bg-sidebar-background border-r border-sidebar-border transition-all duration-300 flex flex-col flex-shrink-0',
        collapsed ? 'w-16' : 'w-56'
      )}
    >
      <SidebarContent />
    </aside>
  );
};
