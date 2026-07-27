import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BarChart3, Bell, Building2, TrendingDown, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Period = 'week' | 'month' | 'quarter' | 'year';
interface CurrencyTotal { type: 'income' | 'expense'; currency: string; amount: number; transaction_count: number }
interface DepartmentTotal { department_name: string; currency: string; income: number; expense: number }
interface Summary {
  currencyTotals: CurrencyTotal[];
  departmentTotals: DepartmentTotal[];
  notificationTotals: { income: number; expense: number };
}
interface Response { valid: boolean; analytics?: Summary }

const periodDays: Record<Period, number> = { week: 7, month: 31, quarter: 92, year: 366 };
const labels: Record<Period, string> = { week: 'Неделя', month: 'Месяц', quarter: 'Квартал', year: 'Год' };
const moneyText = (rows: CurrencyTotal[], type: 'income' | 'expense') =>
  rows.filter(row => row.type === type)
    .map(row => `${Number(row.amount).toLocaleString('ru-RU')} ${row.currency}`)
    .join(' · ') || '0';

const PublicAnalytics = () => {
  const { token = '' } = useParams();
  const [period, setPeriod] = useState<Period>('month');
  const [data, setData] = useState<Response | null>(null);

  useEffect(() => {
    const from = new Date();
    from.setDate(from.getDate() - periodDays[period]);
    setData(null);
    supabase.functions.invoke<Response>('public-transactions', {
      body: { token, action: 'analytics', fromDate: from.toISOString().slice(0, 10) },
    }).then(({ data }) => setData(data || { valid: false }));
  }, [token, period]);

  if (!data) return <main className="p-8 text-center">Загрузка аналитики…</main>;
  if (!data.valid || !data.analytics) return <main className="p-8 text-center text-destructive">Ссылка не найдена или сервер аналитики ещё не обновлён</main>;

  const summary = data.analytics;
  const count = (type: 'income' | 'expense') => summary.currencyTotals
    .filter(row => row.type === type)
    .reduce((total, row) => total + Number(row.transaction_count), 0);

  return (
    <main className="min-h-screen bg-background p-3 sm:p-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold"><BarChart3 />Публичная аналитика</h1>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(labels) as Period[]).map(value => (
              <Button key={value} variant={period === value ? 'default' : 'outline'} size="sm" onClick={() => setPeriod(value)}>{labels[value]}</Button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card><CardHeader><CardTitle className="flex gap-2 text-green-500"><TrendingUp />Доходы</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{moneyText(summary.currencyTotals, 'income')}</p><p className="text-muted-foreground">Операций: {count('income')}</p></CardContent></Card>
          <Card><CardHeader><CardTitle className="flex gap-2 text-red-500"><TrendingDown />Расходы</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{moneyText(summary.currencyTotals, 'expense')}</p><p className="text-muted-foreground">Операций: {count('expense')}</p></CardContent></Card>
        </div>
        <Card><CardHeader><CardTitle className="flex gap-2"><Building2 />Аналитика по отделам</CardTitle></CardHeader><CardContent className="space-y-2">
          {summary.departmentTotals.map(row => <div key={`${row.department_name}-${row.currency}`} className="grid grid-cols-4 gap-2 rounded border p-3"><strong>{row.department_name}</strong><span>{row.currency}</span><span className="text-green-500">Доход: {Number(row.income).toLocaleString('ru-RU')}</span><span className="text-red-500">Расход: {Number(row.expense).toLocaleString('ru-RU')}</span></div>)}
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="flex gap-2"><Bell />Аналитика уведомлений</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2"><div className="rounded border p-3">Доходы: <strong>{summary.notificationTotals.income}</strong></div><div className="rounded border p-3">Расходы: <strong>{summary.notificationTotals.expense}</strong></div></CardContent></Card>
      </div>
    </main>
  );
};

export default PublicAnalytics;
