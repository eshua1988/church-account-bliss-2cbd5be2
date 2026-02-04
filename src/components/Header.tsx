import { LanguageSelector } from './LanguageSelector';
import { UserMenu } from './UserMenu';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface HeaderProps {
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

export const Header = ({ canUndo, canRedo, onUndo, onRedo }: HeaderProps) => {
  const isMobile = useIsMobile();
  
  return (
    <header className="bg-card border-b border-border shadow-sm">
      <div className={cn(
        "container mx-auto py-3",
        isMobile ? "px-4 pl-16" : "px-4"
      )}>
        <div className="flex items-center justify-end">
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
