import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BarChart3, Bell, Building2, TrendingDown, TrendingUp } from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Period = 'week' | 'month' | 'quarter' | 'year';
interface CurrencyTotal { type: 'income' | 'expense'; currency: string; amount: number; transaction_count: number }
interface DepartmentTotal { department_name: string; currency: string; income: number; expense: number }
interface CategoryTotal { category_name: string; currency: string; income: number; expense: number; income_count: number; expense_count: number }
interface DailyTotal { date: string; currency: string; income: number; expense: number; income_count: number; expense_count: number }
interface Summary {
  currencyTotals: CurrencyTotal[];
  departmentTotals: DepartmentTotal[];
  categoryTotals: CategoryTotal[];
  dailyTotals: DailyTotal[];
  notificationTotals: { income: number; expense: number };
}
interface Response { valid: boolean; analytics?: Summary }

const periodDays: Record<Period, number> = { week: 7, month: 31, quarter: 92, year: 366 };
const labels: Record<Period, string> = { week: 'Неделя', month: 'Месяц', quarter: 'Квартал', year: 'Год' };
const COLORS = ['#22c55e', '#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
const number = (value: unknown) => Number(value) || 0;
const money = (value: unknown) => number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const ChartCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Card>
    <CardHeader className="pb-2"><CardTitle className="text-lg">{title}</CardTitle></CardHeader>
    <CardContent className="h-72">{children}</CardContent>
  </Card>
);

const PublicAnalytics = () => {
  const { token = '' } = useParams();
  const [period, setPeriod] = useState<Period>('month');
  const [currency, setCurrency] = useState('');
  const [data, setData] = useState<Response | null>(null);

  useEffect(() => {
    const from = new Date();
    from.setDate(from.getDate() - periodDays[period]);
    setData(null);
    supabase.functions.invoke<Response>('public-transactions', {
      body: { token, action: 'analytics', fromDate: from.toISOString().slice(0, 10) },
    }).then(({ data }) => setData(data || { valid: false }));
  }, [token, period]);

  const summary = data?.analytics;
  const currencies = useMemo(() => Array.from(new Set(summary?.currencyTotals.map(row => row.currency) || [])), [summary]);
  useEffect(() => {
    if (currencies.length && !currencies.includes(currency)) setCurrency(currencies.includes('PLN') ? 'PLN' : currencies[0]);
  }, [currencies, currency]);

  if (!data) return <main className="p-8 text-center">Загрузка аналитики…</main>;
  if (!data.valid || !summary) return <main className="p-8 text-center text-destructive">Ссылка не найдена или сервер аналитики ещё не обновлён</main>;

  const totals = summary.currencyTotals.filter(row => row.currency === currency);
  const departments = summary.departmentTotals.filter(row => row.currency === currency)
    .map(row => ({ name: row.department_name, income: number(row.income), expense: number(row.expense) }))
    .sort((a, b) => b.income + b.expense - a.income - a.expense);
  const categories = (summary.categoryTotals || []).filter(row => row.currency === currency)
    .map(row => ({ name: row.category_name, income: number(row.income), expense: number(row.expense), count: number(row.income_count) + number(row.expense_count) }))
    .sort((a, b) => b.income + b.expense - a.income - a.expense);
  let cumulative = 0;
  const daily = (summary.dailyTotals || []).filter(row => row.currency === currency).map(row => {
    const income = number(row.income);
    const expense = number(row.expense);
    cumulative += income - expense;
    return {
      date: new Date(`${row.date}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
      income, expense, balance: income - expense, cumulative,
      incomeCount: number(row.income_count), expenseCount: number(row.expense_count),
    };
  });
  const income = totals.find(row => row.type === 'income');
  const expense = totals.find(row => row.type === 'expense');
  const incomeAmount = number(income?.amount);
  const expenseAmount = number(expense?.amount);
  const operationMix = [
    { name: 'Доходы', value: number(income?.transaction_count) },
    { name: 'Расходы', value: number(expense?.transaction_count) },
  ];
  const notificationMix = [
    { name: 'Доходы', value: number(summary.notificationTotals.income) },
    { name: 'Расходы', value: number(summary.notificationTotals.expense) },
  ];

  return (
    <main className="min-h-screen bg-background p-3 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold"><BarChart3 />Публичная аналитика</h1>
          <div className="flex flex-wrap gap-2">
            {currencies.length > 1 && (
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>{currencies.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
              </Select>
            )}
            {(Object.keys(labels) as Period[]).map(value => (
              <Button key={value} variant={period === value ? 'default' : 'outline'} size="sm" onClick={() => setPeriod(value)}>{labels[value]}</Button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card><CardHeader><CardTitle className="flex gap-2 text-green-500"><TrendingUp />Доходы</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{money(incomeAmount)} {currency}</p><p className="text-muted-foreground">Операций: {number(income?.transaction_count)}</p></CardContent></Card>
          <Card><CardHeader><CardTitle className="flex gap-2 text-red-500"><TrendingDown />Расходы</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{money(expenseAmount)} {currency}</p><p className="text-muted-foreground">Операций: {number(expense?.transaction_count)}</p></CardContent></Card>
          <Card><CardHeader><CardTitle>Баланс</CardTitle></CardHeader><CardContent><p className={`text-2xl font-bold ${incomeAmount - expenseAmount >= 0 ? 'text-green-500' : 'text-red-500'}`}>{money(incomeAmount - expenseAmount)} {currency}</p><p className="text-muted-foreground">Доходы минус расходы</p></CardContent></Card>
          <Card><CardHeader><CardTitle>Средняя операция</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{money((incomeAmount + expenseAmount) / Math.max(1, number(income?.transaction_count) + number(expense?.transaction_count)))} {currency}</p><p className="text-muted-foreground">За выбранный период</p></CardContent></Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Динамика доходов и расходов"><ResponsiveContainer><ComposedChart data={daily}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis /><Tooltip formatter={money} /><Legend /><Bar dataKey="income" name="Доходы" fill="#22c55e" /><Bar dataKey="expense" name="Расходы" fill="#ef4444" /><Line dataKey="balance" name="Баланс" stroke="#3b82f6" strokeWidth={2} /></ComposedChart></ResponsiveContainer></ChartCard>
          <ChartCard title="Накопительный баланс"><ResponsiveContainer><AreaChart data={daily}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis /><Tooltip formatter={money} /><Area dataKey="cumulative" name="Баланс" stroke="#3b82f6" fill="#3b82f680" /></AreaChart></ResponsiveContainer></ChartCard>
          <ChartCard title="Количество операций по дням"><ResponsiveContainer><BarChart data={daily}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="incomeCount" name="Доходы" fill="#22c55e" /><Bar dataKey="expenseCount" name="Расходы" fill="#ef4444" /></BarChart></ResponsiveContainer></ChartCard>
          <ChartCard title="Доходы и расходы по отделам"><ResponsiveContainer><BarChart data={departments.slice(0, 12)} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis dataKey="name" type="category" width={110} /><Tooltip formatter={money} /><Legend /><Bar dataKey="income" name="Доходы" fill="#22c55e" /><Bar dataKey="expense" name="Расходы" fill="#ef4444" /></BarChart></ResponsiveContainer></ChartCard>
          <ChartCard title="Доходы по категориям"><ResponsiveContainer><PieChart><Pie data={categories.filter(row => row.income > 0).slice(0, 10)} dataKey="income" nameKey="name" outerRadius={95} label>{categories.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip formatter={money} /><Legend /></PieChart></ResponsiveContainer></ChartCard>
          <ChartCard title="Расходы по категориям"><ResponsiveContainer><PieChart><Pie data={categories.filter(row => row.expense > 0).slice(0, 10)} dataKey="expense" nameKey="name" outerRadius={95} label>{categories.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip formatter={money} /><Legend /></PieChart></ResponsiveContainer></ChartCard>
          <ChartCard title="Количество операций по категориям"><ResponsiveContainer><BarChart data={categories.slice(0, 12)}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" hide /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" name="Операции" fill="#8b5cf6" /></BarChart></ResponsiveContainer></ChartCard>
          <ChartCard title="Соотношение количества операций"><ResponsiveContainer><PieChart><Pie data={operationMix} dataKey="value" nameKey="name" outerRadius={95} label>{operationMix.map((_, index) => <Cell key={index} fill={COLORS[index]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></ChartCard>
          <ChartCard title="Доходы по отделам"><ResponsiveContainer><PieChart><Pie data={departments.filter(row => row.income > 0).slice(0, 10)} dataKey="income" nameKey="name" outerRadius={95} label>{departments.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip formatter={money} /><Legend /></PieChart></ResponsiveContainer></ChartCard>
          <ChartCard title="Расходы по отделам"><ResponsiveContainer><PieChart><Pie data={departments.filter(row => row.expense > 0).slice(0, 10)} dataKey="expense" nameKey="name" outerRadius={95} label>{departments.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip formatter={money} /><Legend /></PieChart></ResponsiveContainer></ChartCard>
          <ChartCard title="Уведомления: доходы и расходы"><ResponsiveContainer><PieChart><Pie data={notificationMix} dataKey="value" nameKey="name" outerRadius={95} label>{notificationMix.map((_, index) => <Cell key={index} fill={COLORS[index]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></ChartCard>
          <ChartCard title="Дневной чистый результат"><ResponsiveContainer><BarChart data={daily}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis /><Tooltip formatter={money} /><Bar dataKey="balance" name="Баланс">{daily.map((row, index) => <Cell key={index} fill={row.balance >= 0 ? '#22c55e' : '#ef4444'} />)}</Bar></BarChart></ResponsiveContainer></ChartCard>
        </div>

        <Card><CardHeader><CardTitle className="flex gap-2"><Building2 />Аналитика по отделам</CardTitle></CardHeader><CardContent className="space-y-2">
          {departments.map(row => <div key={row.name} className="grid gap-2 rounded border p-3 sm:grid-cols-3"><strong>{row.name}</strong><span className="text-green-500">Доход: {money(row.income)} {currency}</span><span className="text-red-500">Расход: {money(row.expense)} {currency}</span></div>)}
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="flex gap-2"><Bell />Аналитика уведомлений</CardTitle></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2"><div className="rounded border p-3">Доходы: <strong>{summary.notificationTotals.income}</strong></div><div className="rounded border p-3">Расходы: <strong>{summary.notificationTotals.expense}</strong></div></CardContent></Card>
      </div>
    </main>
  );
};

export default PublicAnalytics;
