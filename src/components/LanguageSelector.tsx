import { useTranslation } from '@/contexts/LanguageContext';
import { Language, LANGUAGE_NAMES } from '@/hooks/useLanguage';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Globe } from 'lucide-react';

const languages: Language[] = ['pl', 'ru', 'en', 'uk'];

const languageFlags: Record<Language, string> = {
  pl: '🇵🇱',
  ru: '🇷🇺',
  en: '🇬🇧',
  uk: '🇺🇦',
};

export const LanguageSelector = () => {
  const { language, setLanguage } = useTranslation();

  return (
    <Select value={language} onValueChange={(v) => setLanguage(v as Language)}>
      <SelectTrigger className="w-[140px] bg-card border-border">
        <Globe className="w-4 h-4 mr-2 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {languages.map((lang) => (
          <SelectItem key={lang} value={lang}>
            <span className="flex items-center gap-2">
              <span>{languageFlags[lang]}</span>
              <span>{LANGUAGE_NAMES[lang]}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
