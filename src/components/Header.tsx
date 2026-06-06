import { useEffect, useState } from 'react';
import { LanguageSelector } from './LanguageSelector';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Book,
  Building2,
  ChevronLeft,
  ChevronRight,
  Church,
  Cross,
  Crown,
  Flame,
  Globe,
  Heart,
  Home,
  Landmark,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Shield,
  Star,
  Sun,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/contexts/LanguageContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { TransactionForm } from './TransactionForm';
import { Transaction } from '@/types/transaction';
import { Category } from '@/hooks/useSupabaseCategories';

export const HEADER_SETTINGS_UPDATED_EVENT = 'church-header-settings-updated';
const HEADER_SETTINGS_KEY = 'church_header_settings';

export interface HeaderSettings {
  iconName: string;
  title: string;
  subtitle: string;
  customImage?: string;
}

export const HEADER_ICON_OPTIONS: { name: string; icon: LucideIcon }[] = [
  { name: 'Church', icon: Church },
  { name: 'Building2', icon: Building2 },
  { name: 'Cross', icon: Cross },
  { name: 'Heart', icon: Heart },
  { name: 'Star', icon: Star },
  { name: 'Book', icon: Book },
  { name: 'Home', icon: Home },
  { name: 'Shield', icon: Shield },
  { name: 'Crown', icon: Crown },
  { name: 'Landmark', icon: Landmark },
  { name: 'Users', icon: Users },
  { name: 'Globe', icon: Globe },
  { name: 'Sun', icon: Sun },
  { name: 'Moon', icon: Moon },
  { name: 'Flame', icon: Flame },
];

export const loadHeaderSettings = (): HeaderSettings | null => {
  try {
    const raw = localStorage.getItem(HEADER_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const saveHeaderSettings = (settings: HeaderSettings | null) => {
  if (settings) {
    localStorage.setItem(HEADER_SETTINGS_KEY, JSON.stringify(settings));
  } else {
    localStorage.removeItem(HEADER_SETTINGS_KEY);
  }
  window.dispatchEvent(new Event(HEADER_SETTINGS_UPDATED_EVENT));
};

interface HeaderProps {
  collapsed?: boolean;
  onToggleSidebar?: () => void;
  onOpenMobileMenu?: () => void;
  onAddTransaction?: (transaction: Omit<Transaction, 'id' | 'createdAt'>) => Promise<void>;
  onSync?: () => void;
  isSyncing?: boolean;
  incomeCategories?: Category[];
  expenseCategories?: Category[];
}

export const Header = ({
  collapsed,
  onToggleSidebar,
  onOpenMobileMenu,
  onAddTransaction,
  onSync,
  isSyncing = false,
  incomeCategories = [],
  expenseCategories = [],
}: HeaderProps) => {
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  const [isTransactionDialogOpen, setIsTransactionDialogOpen] = useState(false);
  const [headerSettings, setHeaderSettings] = useState<HeaderSettings | null>(loadHeaderSettings);

  useEffect(() => {
    const syncSettings = () => setHeaderSettings(loadHeaderSettings());
    window.addEventListener('storage', syncSettings);
    window.addEventListener(HEADER_SETTINGS_UPDATED_EVENT, syncSettings);
    return () => {
      window.removeEventListener('storage', syncSettings);
      window.removeEventListener(HEADER_SETTINGS_UPDATED_EVENT, syncSettings);
    };
  }, []);

  const currentIconName = headerSettings?.iconName || 'Church';
  const currentCustomImage = headerSettings?.customImage;
  const CurrentIcon = HEADER_ICON_OPTIONS.find(i => i.name === currentIconName)?.icon || Church;
  const displayTitle = headerSettings?.title || t('appTitle');
  const displaySubtitle = headerSettings?.subtitle || t('appSubtitle');

  const handleAddTransaction = async (transaction: Omit<Transaction, 'id' | 'createdAt'>) => {
    if (onAddTransaction) {
      await onAddTransaction(transaction);
      setIsTransactionDialogOpen(false);
    }
  };

  const renderHeaderIcon = () => {
    if (currentIconName === 'custom' && currentCustomImage) {
      return (
        <img src={currentCustomImage} alt="" className="h-10 w-10 flex-shrink-0 rounded-xl object-cover" />
      );
    }

    return (
      <div className="gradient-primary shadow-glow flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl">
        <CurrentIcon className="h-5 w-5 text-primary-foreground" />
      </div>
    );
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card shadow-sm">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isMobile ? (
              <Button variant="ghost" size="icon" onClick={onOpenMobileMenu} className="flex-shrink-0">
                <Menu className="h-5 w-5" />
              </Button>
            ) : (
              <Button variant="ghost" size="icon" onClick={onToggleSidebar} className="flex-shrink-0">
                {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
              </Button>
            )}

            {renderHeaderIcon()}

            <div className="hidden min-w-0 sm:block">
              <h1 className="text-sm font-bold leading-tight text-foreground">{displayTitle}</h1>
              <p className="truncate text-xs leading-tight text-muted-foreground">{displaySubtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            {onSync && (
              <Button
                variant="outline"
                size={isMobile ? 'icon' : 'default'}
                onClick={onSync}
                disabled={isSyncing}
                aria-label="Синхронизация"
                title={isSyncing ? 'Синхронизация...' : 'Синхронизация'}
                className="flex-shrink-0"
              >
                <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''} ${isMobile ? '' : 'sm:mr-2'}`} />
                <span className="hidden sm:inline">{isSyncing ? 'Синхронизация...' : 'Синхронизация'}</span>
              </Button>
            )}

            {onAddTransaction && (
              <Dialog open={isTransactionDialogOpen} onOpenChange={setIsTransactionDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gradient-primary text-primary-foreground font-semibold shadow-glow transition-all duration-200 hover:shadow-lg">
                    <Plus className="h-4 w-4 sm:mr-2" />
                    <span className="hidden sm:inline">{t('addTransaction')}</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="flex max-h-[90vh] w-[95vw] flex-col overflow-hidden sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>{t('newTransaction')}</DialogTitle>
                  </DialogHeader>
                  <div className="flex-1 overflow-y-auto pr-2">
                    <TransactionForm
                      onSubmit={handleAddTransaction}
                      incomeCategories={incomeCategories}
                      expenseCategories={expenseCategories}
                    />
                  </div>
                </DialogContent>
              </Dialog>
            )}

            <LanguageSelector />
          </div>
        </div>
      </div>
    </header>
  );
};
