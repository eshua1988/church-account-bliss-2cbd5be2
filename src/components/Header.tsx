import { Church } from 'lucide-react';
import { LanguageSelector } from './LanguageSelector';
import { useTranslation } from '@/contexts/LanguageContext';

export const Header = () => {
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
          <LanguageSelector />
        </div>
      </div>
    </header>
  );
};
