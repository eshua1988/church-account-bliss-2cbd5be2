import { useState, useEffect } from 'react';
import { LanguageSelector } from './LanguageSelector';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Church, ChevronLeft, ChevronRight, Menu, Plus,
  Building2, Cross, Heart, Star, Book, Home, Shield, Crown, Landmark,
  Users, Globe, Sun, Moon, Flame, type LucideIcon
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TransactionForm } from './TransactionForm';
import { Transaction } from '@/types/transaction';
import { Category } from '@/hooks/useSupabaseCategories';

const ICON_OPTIONS: { name: string; icon: LucideIcon }[] = [
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

const HEADER_SETTINGS_KEY = 'church_header_settings';

interface HeaderSettings {
  iconName: string;
  title: string;
  subtitle: string;
}

const loadHeaderSettings = (): HeaderSettings | null => {
  try {
    const raw = localStorage.getItem(HEADER_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

interface HeaderProps {
  collapsed?: boolean;
  onToggleSidebar?: () => void;
  onOpenMobileMenu?: () => void;
  onAddTransaction?: (transaction: Omit<Transaction, 'id' | 'createdAt'>) => Promise<void>;
  incomeCategories?: Category[];
  expenseCategories?: Category[];
}

export const Header = ({
  collapsed,
  onToggleSidebar, 
  onOpenMobileMenu,
  onAddTransaction,
  incomeCategories = [],
  expenseCategories = [],
}: HeaderProps) => {
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  const [isTransactionDialogOpen, setIsTransactionDialogOpen] = useState(false);

  // Header branding settings
  const [headerSettings, setHeaderSettings] = useState<HeaderSettings | null>(loadHeaderSettings);
  const [brandingOpen, setBrandingOpen] = useState(false);
  const [editIcon, setEditIcon] = useState('Church');
  const [editTitle, setEditTitle] = useState('');
  const [editSubtitle, setEditSubtitle] = useState('');

  useEffect(() => {
    if (headerSettings) {
      localStorage.setItem(HEADER_SETTINGS_KEY, JSON.stringify(headerSettings));
    } else {
      localStorage.removeItem(HEADER_SETTINGS_KEY);
    }
  }, [headerSettings]);

  const currentIconName = headerSettings?.iconName || 'Church';
  const CurrentIcon = ICON_OPTIONS.find(i => i.name === currentIconName)?.icon || Church;
  const displayTitle = headerSettings?.title || t('appTitle');
  const displaySubtitle = headerSettings?.subtitle || t('appSubtitle');

  const handleBrandingOpen = (isOpen: boolean) => {
    if (isOpen) {
      setEditIcon(headerSettings?.iconName || 'Church');
      setEditTitle(headerSettings?.title || '');
      setEditSubtitle(headerSettings?.subtitle || '');
    }
    setBrandingOpen(isOpen);
  };

  const handleBrandingSave = () => {
    if (!editTitle && !editSubtitle && editIcon === 'Church') {
      setHeaderSettings(null);
    } else {
      setHeaderSettings({ iconName: editIcon, title: editTitle, subtitle: editSubtitle });
    }
    setBrandingOpen(false);
  };

  const handleBrandingReset = () => {
    setHeaderSettings(null);
    setEditIcon('Church');
    setEditTitle('');
    setEditSubtitle('');
    setBrandingOpen(false);
  };

  const handleAddTransaction = async (transaction: Omit<Transaction, 'id' | 'createdAt'>) => {
    if (onAddTransaction) {
      await onAddTransaction(transaction);
      setIsTransactionDialogOpen(false);
    }
  };

  return (
    <header className="bg-card border-b border-border shadow-sm sticky top-0 z-50">
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

            <Dialog open={brandingOpen} onOpenChange={handleBrandingOpen}>
              <DialogTrigger asChild>
                <button className="w-10 h-10 rounded-xl gradient-primary shadow-glow flex items-center justify-center flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity">
                  <CurrentIcon className="w-5 h-5 text-primary-foreground" />
                </button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Настройки заголовка</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label className="mb-2 block">Иконка</Label>
                    <div className="grid grid-cols-5 gap-2">
                      {ICON_OPTIONS.map(({ name, icon: Icon }) => (
                        <button
                          key={name}
                          onClick={() => setEditIcon(name)}
                          className={`p-3 rounded-lg border-2 flex items-center justify-center transition-colors ${
                            editIcon === name
                              ? 'border-primary bg-primary/10'
                              : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <Icon className="w-5 h-5" />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="header-title" className="mb-1 block">Заголовок</Label>
                    <Input
                      id="header-title"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder={t('appTitle')}
                    />
                  </div>
                  <div>
                    <Label htmlFor="header-subtitle" className="mb-1 block">Подзаголовок</Label>
                    <Input
                      id="header-subtitle"
                      value={editSubtitle}
                      onChange={(e) => setEditSubtitle(e.target.value)}
                      placeholder={t('appSubtitle')}
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={handleBrandingReset}>
                      Сбросить
                    </Button>
                    <Button size="sm" onClick={handleBrandingSave}>
                      Сохранить
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <div className="hidden sm:block min-w-0">
              <h1 className="font-bold text-foreground text-sm leading-tight">{displayTitle}</h1>
              <p className="text-muted-foreground text-xs leading-tight truncate">{displaySubtitle}</p>
            </div>
          </div>

          {/* Right: Controls */}
          <div className="flex items-center gap-1 sm:gap-2">
            {onAddTransaction && (
              <Dialog open={isTransactionDialogOpen} onOpenChange={setIsTransactionDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gradient-primary text-primary-foreground font-semibold shadow-glow hover:shadow-lg transition-all duration-200">
                    <Plus className="w-4 h-4 sm:mr-2" />
                    <span className="hidden sm:inline">{t('addTransaction')}</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px] max-h-[90vh] w-[95vw] overflow-hidden flex flex-col">
                  <DialogHeader><DialogTitle>{t('newTransaction')}</DialogTitle></DialogHeader>
                  <div className="overflow-y-auto flex-1 pr-2">
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
