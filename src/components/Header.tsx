import { useState, useEffect, useRef } from 'react';
import { LanguageSelector } from './LanguageSelector';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Church, ChevronLeft, ChevronRight, Menu, Plus, RefreshCw,
  Building2, Cross, Heart, Star, Book, Home, Shield, Crown, Landmark,
  Users, Globe, Sun, Moon, Flame, ImagePlus, Trash2, type LucideIcon
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
const ICON_SIZE = 80;

interface HeaderSettings {
  iconName: string;
  title: string;
  subtitle: string;
  customImage?: string;
}

const loadHeaderSettings = (): HeaderSettings | null => {
  try {
    const raw = localStorage.getItem(HEADER_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const resizeImageToIcon = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = ICON_SIZE;
        canvas.height = ICON_SIZE;
        const ctx = canvas.getContext('2d')!;
        ctx.beginPath();
        ctx.arc(ICON_SIZE / 2, ICON_SIZE / 2, ICON_SIZE / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, ICON_SIZE, ICON_SIZE);
        resolve(canvas.toDataURL('image/png', 0.9));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [headerSettings, setHeaderSettings] = useState<HeaderSettings | null>(loadHeaderSettings);
  const [brandingOpen, setBrandingOpen] = useState(false);
  const [editIcon, setEditIcon] = useState('Church');
  const [editTitle, setEditTitle] = useState('');
  const [editSubtitle, setEditSubtitle] = useState('');
  const [editCustomImage, setEditCustomImage] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (headerSettings) {
      localStorage.setItem(HEADER_SETTINGS_KEY, JSON.stringify(headerSettings));
    } else {
      localStorage.removeItem(HEADER_SETTINGS_KEY);
    }
  }, [headerSettings]);

  const currentIconName = headerSettings?.iconName || 'Church';
  const currentCustomImage = headerSettings?.customImage;
  const CurrentIcon = ICON_OPTIONS.find(i => i.name === currentIconName)?.icon || Church;
  const displayTitle = headerSettings?.title || t('appTitle');
  const displaySubtitle = headerSettings?.subtitle || t('appSubtitle');

  const handleBrandingOpen = (isOpen: boolean) => {
    if (isOpen) {
      setEditIcon(headerSettings?.iconName || 'Church');
      setEditTitle(headerSettings?.title || '');
      setEditSubtitle(headerSettings?.subtitle || '');
      setEditCustomImage(headerSettings?.customImage);
    }
    setBrandingOpen(isOpen);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageToIcon(file);
      setEditCustomImage(dataUrl);
      setEditIcon('custom');
    } catch {
      console.error('Failed to process image');
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveCustomImage = () => {
    setEditCustomImage(undefined);
    if (editIcon === 'custom') setEditIcon('Church');
  };

  const handleBrandingSave = () => {
    const ci = editIcon === 'custom' ? editCustomImage : undefined;
    if (!editTitle && !editSubtitle && editIcon === 'Church' && !ci) {
      setHeaderSettings(null);
    } else {
      setHeaderSettings({ iconName: editIcon, title: editTitle, subtitle: editSubtitle, customImage: ci });
    }
    setBrandingOpen(false);
  };

  const handleBrandingReset = () => {
    setHeaderSettings(null);
    setEditIcon('Church');
    setEditTitle('');
    setEditSubtitle('');
    setEditCustomImage(undefined);
    setBrandingOpen(false);
  };

  const handleAddTransaction = async (transaction: Omit<Transaction, 'id' | 'createdAt'>) => {
    if (onAddTransaction) {
      await onAddTransaction(transaction);
      setIsTransactionDialogOpen(false);
    }
  };

  const renderHeaderIcon = () => {
    if (currentIconName === 'custom' && currentCustomImage) {
      return (
        <img src={currentCustomImage} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
      );
    }
    return (
      <div className="w-10 h-10 rounded-xl gradient-primary shadow-glow flex items-center justify-center flex-shrink-0">
        <CurrentIcon className="w-5 h-5 text-primary-foreground" />
      </div>
    );
  };

  return (
    <header className="bg-card border-b border-border shadow-sm sticky top-0 z-50">
      <div className="container mx-auto py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isMobile ? (
              <Button variant="ghost" size="icon" onClick={onOpenMobileMenu} className="flex-shrink-0">
                <Menu className="w-5 h-5" />
              </Button>
            ) : (
              <Button variant="ghost" size="icon" onClick={onToggleSidebar} className="flex-shrink-0">
                {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              </Button>
            )}

            <Dialog open={brandingOpen} onOpenChange={handleBrandingOpen}>
              <DialogTrigger asChild>
                <button className="cursor-pointer hover:opacity-80 transition-opacity">
                  {renderHeaderIcon()}
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
                      {/* Custom image button */}
                      {editCustomImage ? (
                        <button
                          onClick={() => setEditIcon('custom')}
                          className={`p-1 rounded-lg border-2 flex items-center justify-center transition-colors relative group ${
                            editIcon === 'custom'
                              ? 'border-primary bg-primary/10'
                              : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <img src={editCustomImage} alt="" className="w-8 h-8 rounded-md object-cover" />
                          <button
                            onClick={(ev) => { ev.stopPropagation(); handleRemoveCustomImage(); }}
                            className="absolute -top-1 -right-1 w-4 h-4 bg-destructive rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 className="w-2.5 h-2.5 text-destructive-foreground" />
                          </button>
                        </button>
                      ) : (
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="p-3 rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex items-center justify-center transition-colors"
                        >
                          <ImagePlus className="w-5 h-5 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
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
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''} ${isMobile ? '' : 'sm:mr-2'}`} />
                <span className="hidden sm:inline">{isSyncing ? 'Синхронизация...' : 'Синхронизация'}</span>
              </Button>
            )}
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
