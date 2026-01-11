import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useTranslation } from '@/contexts/LanguageContext';
import { Card } from '@/components/ui/card';
import { format, parse } from 'date-fns';
import { pl, ru, enUS, uk } from 'date-fns/locale';

<<<<<<< HEAD
import { Currency, CURRENCY_SYMBOLS } from '@/types/transaction';

=======
>>>>>>> fd9e39d (fix: sidebar no longer overlaps main content)
interface BalanceLineChartProps {
  data: Array<{
    month: string;
    income: number;
    expense: number;
    balance: number;
  }>;
<<<<<<< HEAD
  currency?: Currency;
  startDate?: Date;
  endDate?: Date;
}

export const BalanceLineChart = ({ data, currency = 'PLN', startDate, endDate }: BalanceLineChartProps) => {
=======
}

export const BalanceLineChart = ({ data }: BalanceLineChartProps) => {
>>>>>>> fd9e39d (fix: sidebar no longer overlaps main content)
  const { t, language } = useTranslation();

  const getLocale = () => {
    switch (language) {
      case 'pl': return pl;
      case 'ru': return ru;
      case 'uk': return uk;
      default: return enUS;
    }
  };

<<<<<<< HEAD
  // Filter by start/end if provided (data.month is 'yyyy-MM')
  const inRange = (monthKey: string) => {
    if (!startDate && !endDate) return true;
    const keyToNumber = (k: string) => parseInt(k.replace('-', ''), 10);
    const mNum = keyToNumber(monthKey);
    const startNum = startDate ? keyToNumber(`${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`) : -Infinity;
    const endNum = endDate ? keyToNumber(`${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}`) : Infinity;
    return mNum >= startNum && mNum <= endNum;
  };

  const filtered = data.filter(d => inRange(d.month));

  const formattedData = filtered.map(item => ({
=======
  const formattedData = data.map(item => ({
>>>>>>> fd9e39d (fix: sidebar no longer overlaps main content)
    ...item,
    monthLabel: format(parse(item.month, 'yyyy-MM', new Date()), 'MMM yyyy', { locale: getLocale() }),
  }));

  // Calculate cumulative balance
  let cumulative = 0;
  const cumulativeData = formattedData.map(item => {
    cumulative += item.balance;
    return {
      ...item,
      cumulativeBalance: cumulative,
    };
  });

<<<<<<< HEAD
  if (filtered.length === 0) {
    return (
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">{t('balanceOverTime')} ({CURRENCY_SYMBOLS[currency]} {currency})</h3>
=======
  if (data.length === 0) {
    return (
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">{t('balanceOverTime')}</h3>
>>>>>>> fd9e39d (fix: sidebar no longer overlaps main content)
        <div className="h-[250px] flex items-center justify-center text-muted-foreground">
          {t('noTransactions')}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4">{t('balanceOverTime')}</h3>
      <div className="h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={cumulativeData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis 
              dataKey="monthLabel" 
              className="text-muted-foreground"
              tick={{ fontSize: 12 }}
            />
            <YAxis 
              className="text-muted-foreground"
              tick={{ fontSize: 12 }}
<<<<<<< HEAD
              tickFormatter={(value) => `${value.toLocaleString()} ${CURRENCY_SYMBOLS[currency]}`}
            />
            <Tooltip
              formatter={(value: number) => `${value.toLocaleString()} ${CURRENCY_SYMBOLS[currency]}`}
=======
              tickFormatter={(value) => value.toLocaleString()}
            />
            <Tooltip
              formatter={(value: number) => value.toLocaleString()}
>>>>>>> fd9e39d (fix: sidebar no longer overlaps main content)
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="cumulativeBalance"
              name={t('balance')}
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={{ fill: 'hsl(var(--primary))' }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
};
