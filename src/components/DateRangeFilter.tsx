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
  const [mode, setMode] = useState<'range' | 'single'>('range');

  useEffect(() => setLocalRange(value || {}), [value]);

  const displayLabel = () => {
    if (mode === 'single' && localRange?.from) {
      try {
        return localRange.from.toLocaleDateString(getDateLocale());
      } catch (e) {
        return format(localRange.from, 'yyyy-MM-dd');
      }
    }

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
        <div className="mb-3 flex items-center gap-2">
          <Button
            variant={mode === 'range' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setMode('range')}
            className={mode === 'range' ? 'font-medium' : ''}
          >
            {t('rangeMode')}
          </Button>
          <Button
            variant={mode === 'single' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setMode('single')}
            className={mode === 'single' ? 'font-medium' : ''}
          >
            {t('singleDate')}
          </Button>
        </div>

        <Calendar
          mode={mode === 'range' ? 'range' : 'single'}
          selected={mode === 'range' ? (localRange as any) : (localRange.from as any)}
          onSelect={(r: any) => {
            if (!r) return;
            if (mode === 'range') {
              if (r.from || r.to) setLocalRange(r as Range);
              else setLocalRange({ from: r as Date, to: r as Date });
            } else {
              // single mode: normalize to from/to for compatibility
              const d = r as Date;
              setLocalRange({ from: d, to: d });
            }
          }}
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => { setLocalRange({}); onChange({}); setOpen(false); }}>
            {t('reset')}
          </Button>
          <Button onClick={() => {
            // If single mode and a date is selected, set from=to to keep API stable
            if (mode === 'single' && localRange.from) {
              onChange({ from: localRange.from, to: localRange.from });
            } else {
              onChange(localRange || {});
            }
            setOpen(false);
          }}>
            {t('apply')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default DateRangeFilter;