import { useState, useEffect } from 'react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { useTranslation } from '@/contexts/LanguageContext';
import { format } from 'date-fns';

type Range = { from?: Date; to?: Date };

interface DateRangeFilterProps {
  value?: Range;
  onChange: (range: Range) => void;
}

export const DateRangeFilter = ({ value, onChange }: DateRangeFilterProps) => {
  const { t, getDateLocale } = useTranslation();
  const [localRange, setLocalRange] = useState<Range>(value || {});
  const [open, setOpen] = useState(false);

  useEffect(() => setLocalRange(value || {}), [value]);

  const displayLabel = () => {
    if (localRange?.from && localRange?.to) {
      try {
        const from = localRange.from.toLocaleDateString(getDateLocale());
        const to = localRange.to.toLocaleDateString(getDateLocale());
        return `${from} — ${to}`;
      } catch (e) {
        return `${format(localRange.from, 'yyyy-MM-dd')} — ${format(localRange.to, 'yyyy-MM-dd')}`;
      }
    }
    return t('timeRange');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="font-medium">
          {displayLabel()}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto">
        <Calendar
          mode="range"
          selected={localRange as any}
          onSelect={(r: any) => {
            // r can be a Date or a { from, to }
            if (!r) return;
            if (r.from || r.to) setLocalRange(r as Range);
            else setLocalRange({ from: r as Date, to: r as Date });
          }}
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => { setLocalRange({}); onChange({}); setOpen(false); }}>
            {t('reset')}
          </Button>
          <Button onClick={() => { onChange(localRange || {}); setOpen(false); }}>
            {t('apply')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default DateRangeFilter;