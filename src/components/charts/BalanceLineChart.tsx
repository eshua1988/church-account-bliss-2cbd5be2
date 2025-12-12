import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useTranslation } from '@/contexts/LanguageContext';
import { Card } from '@/components/ui/card';
import { format, parse } from 'date-fns';
import { pl, ru, enUS, uk } from 'date-fns/locale';

interface BalanceLineChartProps {
  data: Array<{
    month: string;
    income: number;
    expense: number;
    balance: number;
  }>;
}

export const BalanceLineChart = ({ data }: BalanceLineChartProps) => {
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

  // Calculate cumulative balance
  let cumulative = 0;
  const cumulativeData = formattedData.map(item => {
    cumulative += item.balance;
    return {
      ...item,
      cumulativeBalance: cumulative,
    };
  });

  if (data.length === 0) {
    return (
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">{t('balanceOverTime')}</h3>
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
              tickFormatter={(value) => value.toLocaleString()}
            />
            <Tooltip
              formatter={(value: number) => value.toLocaleString()}
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
