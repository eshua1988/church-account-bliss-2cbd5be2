import { Church } from 'lucide-react';
import { LanguageSelector } from './LanguageSelector';
import { useTranslation } from '@/contexts/LanguageContext';

interface HeaderProps {
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

export const Header = ({ canUndo, canRedo, onUndo, onRedo }: HeaderProps) => {
  const { t } = useTranslation();
  
  return (
    <header className="bg-card border-b border-border shadow-sm">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl gradient-primary shadow-glow">
              <Church className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">{t('appTitle')}</h1>
              <p className="text-sm text-muted-foreground">{t('appSubtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {typeof onUndo === 'function' && (
              <button
                onClick={onUndo}
                disabled={!canUndo}
                className="p-2 rounded-md hover:bg-accent disabled:opacity-50"
                title="Undo (Ctrl+Z)"
              >
                ↶
              </button>
            )}
            {typeof onRedo === 'function' && (
              <button
                onClick={onRedo}
                disabled={!canRedo}
                className="p-2 rounded-md hover:bg-accent disabled:opacity-50"
                title="Redo (Ctrl+Y)"
              >
                ↷
              </button>
            )}
            <LanguageSelector />
          </div>
        </div>
      </div>
    </header>
  );
};
