import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import {
  HEADER_ICON_OPTIONS,
  HeaderSettings,
  loadHeaderSettings,
  saveHeaderSettings,
} from '@/components/Header';

const ICON_SIZE = 80;

const resizeImageToIcon = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = ICON_SIZE;
        canvas.height = ICON_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas is not available'));
          return;
        }

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

export const HeaderBrandingSettings = () => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savedSettings = loadHeaderSettings();

  const [editIcon, setEditIcon] = useState(savedSettings?.iconName || 'Church');
  const [editTitle, setEditTitle] = useState(savedSettings?.title || '');
  const [editSubtitle, setEditSubtitle] = useState(savedSettings?.subtitle || '');
  const [editCustomImage, setEditCustomImage] = useState<string | undefined>(savedSettings?.customImage);

  const syncPayoutLinksOrganizationName = async (organizationName: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('shared_payout_links')
      .update({ organization_name: organizationName })
      .eq('owner_user_id', user.id);

    if (error) {
      console.error('Failed to sync payout link organization name:', error);
    }
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

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveCustomImage = () => {
    setEditCustomImage(undefined);
    if (editIcon === 'custom') {
      setEditIcon('Church');
    }
  };

  const handleSave = async () => {
    const customImage = editIcon === 'custom' ? editCustomImage : undefined;
    const settings: HeaderSettings | null =
      !editTitle && !editSubtitle && editIcon === 'Church' && !customImage
        ? null
        : {
            iconName: editIcon,
            title: editTitle,
            subtitle: editSubtitle,
            customImage,
          };

    saveHeaderSettings(settings);
    await syncPayoutLinksOrganizationName((editSubtitle || t('appSubtitle')).trim());
  };

  const handleReset = async () => {
    setEditIcon('Church');
    setEditTitle('');
    setEditSubtitle('');
    setEditCustomImage(undefined);
    saveHeaderSettings(null);
    await syncPayoutLinksOrganizationName(t('appSubtitle'));
  };

  return (
    <div className="space-y-5">
      <div>
        <h5 className="mb-3 text-sm font-semibold">Настройки заголовка</h5>
        <p className="mb-4 text-sm text-muted-foreground">
          Эти параметры меняют иконку, название и подзаголовок в верхней панели приложения.
        </p>
      </div>

      <div>
        <Label className="mb-2 block">Иконка</Label>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
          {HEADER_ICON_OPTIONS.map(({ name, icon: Icon }) => (
            <button
              key={name}
              type="button"
              onClick={() => setEditIcon(name)}
              className={`flex h-12 items-center justify-center rounded-lg border-2 transition-colors ${
                editIcon === name
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50'
              }`}
              title={name}
            >
              <Icon className="h-5 w-5" />
            </button>
          ))}

          {editCustomImage ? (
            <button
              type="button"
              onClick={() => setEditIcon('custom')}
              className={`group relative flex h-12 items-center justify-center rounded-lg border-2 p-1 transition-colors ${
                editIcon === 'custom'
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-primary/50'
              }`}
              title="Своя иконка"
            >
              <img src={editCustomImage} alt="" className="h-9 w-9 rounded-md object-cover" />
              <span
                role="button"
                tabIndex={0}
                onClick={(ev) => {
                  ev.stopPropagation();
                  handleRemoveCustomImage();
                }}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    handleRemoveCustomImage();
                  }
                }}
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive opacity-0 transition-opacity group-hover:opacity-100"
                title="Удалить иконку"
              >
                <Trash2 className="h-3 w-3 text-destructive-foreground" />
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-12 items-center justify-center rounded-lg border-2 border-dashed border-border transition-colors hover:border-primary/50"
              title="Загрузить свою иконку"
            >
              <ImagePlus className="h-5 w-5 text-muted-foreground" />
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

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="header-title" className="mb-1 block">
            Заголовок
          </Label>
          <Input
            id="header-title"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder={t('appTitle')}
          />
        </div>

        <div>
          <Label htmlFor="header-subtitle" className="mb-1 block">
            Подзаголовок
          </Label>
          <Input
            id="header-subtitle"
            value={editSubtitle}
            onChange={(e) => setEditSubtitle(e.target.value)}
            placeholder={t('appSubtitle')}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={handleReset}>
          Сбросить
        </Button>
        <Button onClick={handleSave}>
          Сохранить
        </Button>
      </div>
    </div>
  );
};
