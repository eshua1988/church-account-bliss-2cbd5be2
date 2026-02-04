import { LanguageSelector } from './LanguageSelector';
import { UserMenu } from './UserMenu';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { Church, ChevronLeft, ChevronRight, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/contexts/LanguageContext';

interface HeaderProps {
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  collapsed?: boolean;
  onToggleSidebar?: () => void;
  onOpenMobileMenu?: () => void;
}

export const Header = ({ canUndo, canRedo, onUndo, onRedo, collapsed, onToggleSidebar, onOpenMobileMenu }: HeaderProps) => {
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  
  return (
    <header className="bg-card border-b border-border shadow-sm">
      <div className="container mx-auto py-3 px-4">
        <div className="flex items-center justify-between">
          {/* Left: Logo and title */}
          <div className="flex items-center gap-3">
            {isMobile ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={onOpenMobileMenu}
                className="flex-shrink-0"
              >
                <Menu className="w-5 h-5" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleSidebar}
                className="flex-shrink-0"
              >
                {collapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronLeft className="w-4 h-4" />
                )}
              </Button>
            )}
            <div className="w-10 h-10 rounded-xl gradient-primary shadow-glow flex items-center justify-center flex-shrink-0">
              <Church className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="hidden sm:block min-w-0">
              <h1 className="font-bold text-foreground text-sm leading-tight">{t('appTitle')}</h1>
              <p className="text-muted-foreground text-xs leading-tight truncate">{t('appSubtitle')}</p>
            </div>
          </div>
          
          {/* Right: Controls */}
          <div className="flex items-center gap-1 sm:gap-2">
            {canUndo !== undefined && onUndo && onRedo && (
              <>
                <button
                  onClick={onUndo}
                  disabled={!canUndo}
                  className="p-2 rounded-md hover:bg-accent disabled:opacity-50"
                  title="Undo (Ctrl+Z)"
                >
                  ↶
                </button>
                <button
                  onClick={onRedo}
                  disabled={!canRedo}
                  className="p-2 rounded-md hover:bg-accent disabled:opacity-50"
                  title="Redo (Ctrl+Y)"
                >
                  ↷
                </button>
              </>
            )}
            <LanguageSelector />
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  );
};
