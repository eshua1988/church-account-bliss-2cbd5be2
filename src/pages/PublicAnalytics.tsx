import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BarChart3, Bell, Building2, TrendingDown, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Transaction } from '@/types/transaction';

type Period = 'week' | 'month' | 'quarter' | 'year';
interface AnalyticsNotification { type: string; createdAt: string; documentType?: string }
interface Response { valid: boolean; transactions?: Transaction[]; notifications?: AnalyticsNotification[] }

const periodDays: Record<Period, number> = { week: 7, month: 31, quarter: 92, year: 366 };
const labels: Record<Period, string> = { week: 'Неделя', month: 'Месяц', quarter: 'Квартал', year: 'Год' };
const moneyGroups = (transactions: Transaction[]) => transactions.reduce<Record<string, number>>((result, item) => {
  result[item.currency] = (result[item.currency] || 0) + Number(item.amount);
  return result;
}, {});
const moneyText = (groups: Record<string, number>) =>
  Object.entries(groups).map(([currency, amount]) => `${amount.toLocaleString('ru-RU')} ${currency}`).join(' · ') || '0';

const PublicAnalytics = () => {
  const { token = '' } = useParams();
  const [period, setPeriod] = useState<Period>('month');
  const [data, setData] = useState<Response | null>(null);

  useEffect(() => {
    supabase.functions.invoke<Response>('public-transactions', { body: { token, includeNotifications: true } })
      .then(({ data }) => setData(data || { valid: false }));
  }, [token]);

  const analytics = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - periodDays[period]);
    const transactions = (data?.transactions || []).filter(item => new Date(item.date) >= cutoff);
    const notifications = (data?.notifications || []).filter(item => new Date(item.createdAt) >= cutoff);
    const income = transactions.filter(item => item.type === 'income');
    const expense = transactions.filter(item => item.type === 'expense');
    const departments = transactions.reduce<Record<string, { income: number; expense: number }>>((result, item) => {
      const name = item.departmentName || 'Без отдела';
      result[name] ||= { income: 0, expense: 0 };
      result[name][item.type] += Number(item.amount);
      return result;
    }, {});
    const incomeNotifications = notifications.filter(item => item.type === 'deposit' || item.documentType === 'deposit').length;
    return { income, expense, departments, incomeNotifications, expenseNotifications: notifications.length - incomeNotifications };
  }, [data, period]);

  if (!data) return <main className="p-8 text-center">Загрузка аналитики…</main>;
  if (!data.valid) return <main className="p-8 text-center text-destructive">Ссылка не найдена или отключена</main>;

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
          <Card><CardHeader><CardTitle className="flex gap-2 text-green-500"><TrendingUp />Доходы</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{moneyText(moneyGroups(analytics.income))}</p><p className="text-muted-foreground">Операций: {analytics.income.length}</p></CardContent></Card>
          <Card><CardHeader><CardTitle className="flex gap-2 text-red-500"><TrendingDown />Расходы</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{moneyText(moneyGroups(analytics.expense))}</p><p className="text-muted-foreground">Операций: {analytics.expense.length}</p></CardContent></Card>
        </div>
        <Card><CardHeader><CardTitle className="flex gap-2"><Building2 />Аналитика по отделам</CardTitle></CardHeader><CardContent className="space-y-2">
          {Object.entries(analytics.departments).map(([name, values]) => <div key={name} className="grid grid-cols-3 gap-2 rounded border p-3"><strong>{name}</strong><span className="text-green-500">Доход: {values.income.toLocaleString('ru-RU')}</span><span className="text-red-500">Расход: {values.expense.toLocaleString('ru-RU')}</span></div>)}
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="flex gap-2"><Bell />Аналитика уведомлений</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2"><div className="rounded border p-3">Доходы: <strong>{analytics.incomeNotifications}</strong></div><div className="rounded border p-3">Расходы: <strong>{analytics.expenseNotifications}</strong></div></CardContent></Card>
      </div>
    </main>
  );
};

export default PublicAnalytics;
