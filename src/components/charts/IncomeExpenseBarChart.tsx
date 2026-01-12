import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useTranslation } from '@/contexts/LanguageContext';
import { Card } from '@/components/ui/card';
import { format, parse } from 'date-fns';
import { pl, ru, enUS, uk } from 'date-fns/locale';

import { Currency, CURRENCY_SYMBOLS } from '@/types/transaction';

interface IncomeExpenseBarChartProps {
  data: Array<{
    month: string;
    income: number;
    expense: number;
    balance: number;
  }>;
  currency?: Currency;
}

export const IncomeExpenseBarChart = ({ data, currency = 'PLN' }: IncomeExpenseBarChartProps) => {
  const { t, language } = useTranslation();

  const getLocale = () => {
    switch (language) {
      case 'pl': return pl;
      case 'ru': return ru;
      case 'uk': return uk;
      default: return enUS;
    }
  };

  const formattedData = data.map(item => ({
    ...item,
    monthLabel: format(parse(item.month, 'yyyy-MM', new Date()), 'MMM yyyy', { locale: getLocale() }),
  }));

  if (data.length === 0) {
    return (
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">{t('incomeVsExpenses')} ({currency})</h3>
        <div className="h-[250px] flex items-center justify-center text-muted-foreground">
          {t('noTransactions')}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4">{t('incomeVsExpenses')} ({CURRENCY_SYMBOLS[currency]} {currency})</h3>
      <div className="h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={formattedData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis 
              dataKey="monthLabel" 
              className="text-muted-foreground"
              tick={{ fontSize: 12 }}
            />
            <YAxis 
              className="text-muted-foreground"
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => `${value.toLocaleString()} ${CURRENCY_SYMBOLS[currency]}`}
            />
            <Tooltip
              formatter={(value: number) => `${value.toLocaleString()} ${CURRENCY_SYMBOLS[currency]}`}
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
              }}
            />
            <Legend />
            <Bar 
              dataKey="income" 
              name={t('income')} 
              fill="hsl(var(--success))" 
              radius={[4, 4, 0, 0]}
            />
            <Bar 
              dataKey="expense" 
              name={t('expenses')} 
              fill="hsl(var(--destructive))" 
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
};
