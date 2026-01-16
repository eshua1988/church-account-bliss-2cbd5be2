import { Church } from 'lucide-react';
import { LanguageSelector } from './LanguageSelector';
import { UserMenu } from './UserMenu';
import { useTranslation } from '@/contexts/LanguageContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface HeaderProps {
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

export const Header = ({ canUndo, canRedo, onUndo, onRedo }: HeaderProps) => {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  
  return (
    <header className="bg-card border-b border-border shadow-sm">
      <div className={cn(
        "container mx-auto py-4",
        isMobile ? "px-4 pl-16" : "px-4"
      )}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className={cn(
              "rounded-xl gradient-primary shadow-glow",
              isMobile ? "p-2" : "p-2.5"
            )}>
              <Church className={cn(
                "text-primary-foreground",
                isMobile ? "w-5 h-5" : "w-6 h-6"
              )} />
            </div>
            <div>
              <h1 className={cn(
                "font-bold text-foreground",
                isMobile ? "text-base" : "text-xl"
              )}>{t('appTitle')}</h1>
              <p className={cn(
                "text-muted-foreground",
                isMobile ? "text-xs" : "text-sm"
              )}>{t('appSubtitle')}</p>
            </div>
          </div>
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
