import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BarChart3, Building2, TrendingDown, TrendingUp, X } from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { readPublicLinkCache, writePublicLinkCache } from '@/lib/publicLinkCache';
import { DateRangeFilter } from '@/components/DateRangeFilter';

type TransactionFilter = 'all' | 'income' | 'expense';
type AnalyticsSource = 'all' | 'bank' | 'pdf';
type ChartKey = 'dynamics' | 'cumulative' | 'departments' | 'incomeCategories' | 'expenseCategories' | 'dailyNet';
type DateRange = { from?: Date; to?: Date };
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

const filterLabels: Record<TransactionFilter, string> = { all: 'Все', income: 'Доход', expense: 'Расход' };
const chartLabels: Record<ChartKey, string> = {
  dynamics: 'Динамика доходов и расходов',
  cumulative: 'Накопительный баланс',
  departments: 'Доходы и расходы по отделам',
  incomeCategories: 'Доходы по категориям',
  expenseCategories: 'Расходы по категориям',
  dailyNet: 'Дневной чистый результат',
};
const COLORS = ['#22c55e', '#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
const number = (value: unknown) => Number(value) || 0;
const money = (value: unknown) => number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
const ChartCard = ({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) => (
  <Card>
    <CardHeader className="flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-lg">{title}</CardTitle><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} title="Скрыть график" aria-label="Скрыть график"><X className="h-4 w-4" /></Button></CardHeader>
    <CardContent className="h-[22rem] sm:h-[26rem]">{children}</CardContent>
  </Card>
);
const axisTick = { fill: 'hsl(var(--muted-foreground))', fontSize: 13 };
const tooltipStyle = { backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' };

const PublicAnalytics = () => {
  const { token = '' } = useParams();
  const [transactionFilter, setTransactionFilter] = useState<TransactionFilter>('all');
  const [analyticsSource, setAnalyticsSource] = useState<AnalyticsSource>('all');
  const [customDateRange, setCustomDateRange] = useState<DateRange>({});
  const [currency, setCurrency] = useState('');
  const [data, setData] = useState<Response | null>(null);
  const [visibleCharts, setVisibleCharts] = useState<ChartKey[]>(['dynamics', 'cumulative']);

  useEffect(() => {
    const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const fromDate = customDateRange.from ? dateKey(customDateRange.from) : '1900-01-01';
    const toDate = customDateRange.to ? dateKey(customDateRange.to) : undefined;
    const cacheKey = `public-analytics:${token}:${analyticsSource}:${fromDate}:${toDate || ''}`;
    const cached = readPublicLinkCache<Response>(cacheKey);
    if (cached) {
      setData(cached);
      return;
    }
    setData(null);
    supabase.functions.invoke<Response>('public-transactions', {
      body: { token, action: 'analytics', fromDate, toDate, analyticsSource },
    }).then(({ data }) => {
      const response = data || { valid: false };
      if (response.valid) writePublicLinkCache(cacheKey, response, 5 * 60 * 1000);
      setData(response);
    });
  }, [token, analyticsSource, customDateRange.from, customDateRange.to]);

  const summary = data?.analytics;
  const currencies = useMemo(() => Array.from(new Set(summary?.currencyTotals.map(row => row.currency) || [])), [summary]);
  useEffect(() => {
    if (currency && currencies.length && !currencies.includes(currency)) setCurrency('');
  }, [currencies, currency]);

  if (!data) return <main className="p-8 text-center">Загрузка аналитики…</main>;
  if (!data.valid || !summary) return <main className="p-8 text-center text-destructive">Ссылка не найдена или сервер аналитики ещё не обновлён</main>;

  const showIncome = transactionFilter !== 'expense';
  const showExpense = transactionFilter !== 'income';
  const isAllCurrencies = currency === '';
  const isSelectedCurrency = (rowCurrency: string) => isAllCurrencies || rowCurrency === currency;
  const totals = summary.currencyTotals.filter(row => isSelectedCurrency(row.currency));
  const departments = Object.values(summary.departmentTotals
    .filter(row => isSelectedCurrency(row.currency))
    .reduce<Record<string, { name: string; income: number; expense: number }>>((result, row) => {
      const entry = result[row.department_name] ||= { name: row.department_name, income: 0, expense: 0 };
      entry.income += showIncome ? number(row.income) : 0;
      entry.expense += showExpense ? number(row.expense) : 0;
      return result;
    }, {}))
    .filter(row => row.income > 0 || row.expense > 0)
    .sort((a, b) => b.income + b.expense - a.income - a.expense);
  const categories = Object.values((summary.categoryTotals || [])
    .filter(row => isSelectedCurrency(row.currency))
    .reduce<Record<string, { name: string; income: number; expense: number; count: number }>>((result, row) => {
      const entry = result[row.category_name] ||= { name: row.category_name, income: 0, expense: 0, count: 0 };
      entry.income += showIncome ? number(row.income) : 0;
      entry.expense += showExpense ? number(row.expense) : 0;
      entry.count += (showIncome ? number(row.income_count) : 0) + (showExpense ? number(row.expense_count) : 0);
      return result;
    }, {}))
    .filter(row => row.income > 0 || row.expense > 0)
    .sort((a, b) => b.income + b.expense - a.income - a.expense);
  let cumulative = 0;
  const daily = Object.values((summary.dailyTotals || [])
    .filter(row => isSelectedCurrency(row.currency))
    .reduce<Record<string, { rawDate: string; income: number; expense: number; incomeCount: number; expenseCount: number }>>((result, row) => {
      const entry = result[row.date] ||= { rawDate: row.date, income: 0, expense: 0, incomeCount: 0, expenseCount: 0 };
      entry.income += showIncome ? number(row.income) : 0;
      entry.expense += showExpense ? number(row.expense) : 0;
      entry.incomeCount += showIncome ? number(row.income_count) : 0;
      entry.expenseCount += showExpense ? number(row.expense_count) : 0;
      return result;
    }, {}))
    .sort((left, right) => left.rawDate.localeCompare(right.rawDate))
    .map(row => {
    const income = row.income;
    const expense = row.expense;
    cumulative += income - expense;
    return {
      date: new Date(`${row.rawDate}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
      income, expense, balance: income - expense, cumulative,
      incomeCount: row.incomeCount,
      expenseCount: row.expenseCount,
    };
  });
  const incomeAmount = showIncome ? totals.filter(row => row.type === 'income').reduce((sum, row) => sum + number(row.amount), 0) : 0;
  const expenseAmount = showExpense ? totals.filter(row => row.type === 'expense').reduce((sum, row) => sum + number(row.amount), 0) : 0;
  const incomeCount = showIncome ? totals.filter(row => row.type === 'income').reduce((sum, row) => sum + number(row.transaction_count), 0) : 0;
  const expenseCount = showExpense ? totals.filter(row => row.type === 'expense').reduce((sum, row) => sum + number(row.transaction_count), 0) : 0;
  const toggleChart = (chart: ChartKey) => setVisibleCharts(current => current.includes(chart) ? current.filter(item => item !== chart) : [...current, chart]);
  const hideChart = (chart: ChartKey) => setVisibleCharts(current => current.filter(item => item !== chart));

  return (
    <main className="min-h-screen bg-background p-3 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-3">
            <h1 className="flex items-center gap-2 text-2xl font-bold"><BarChart3 />Публичная аналитика</h1>
            <div className="flex flex-wrap gap-2" aria-label="Источник аналитики">
              <Button variant={analyticsSource === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setAnalyticsSource('all')}>Банк + PDF</Button>
              <Button variant={analyticsSource === 'bank' ? 'default' : 'outline'} size="sm" onClick={() => setAnalyticsSource('bank')}>Банк</Button>
              <Button variant={analyticsSource === 'pdf' ? 'default' : 'outline'} size="sm" onClick={() => setAnalyticsSource('pdf')}>PDF Аналитика</Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {currencies.length > 0 && (
              <Select value={currency || '__all__'} onValueChange={value => setCurrency(value === '__all__' ? '' : value)}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Все валюты</SelectItem>
                  {currencies.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <DateRangeFilter value={customDateRange} onChange={setCustomDateRange} />
            <details className="relative">
              <summary className="flex h-10 cursor-pointer list-none items-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent">Графики</summary>
              <div className="absolute right-0 z-20 mt-2 w-72 space-y-1 rounded-md border bg-popover p-3 shadow-md">
                {(Object.keys(chartLabels) as ChartKey[]).map(chart => <label key={chart} className="flex cursor-pointer items-center gap-3 rounded px-2 py-2 text-sm hover:bg-accent"><input type="checkbox" className="h-4 w-4" checked={visibleCharts.includes(chart)} onChange={() => toggleChart(chart)} /><span>{chartLabels[chart]}</span></label>)}
              </div>
            </details>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Показать:</span>
          {(Object.keys(filterLabels) as TransactionFilter[]).map(value => (
            <Button
              key={value}
              variant={transactionFilter === value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTransactionFilter(value)}
            >
              {filterLabels[value]}
            </Button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card><CardHeader><CardTitle className="flex gap-2 text-green-500"><TrendingUp />Доходы</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{money(incomeAmount)} {currency || 'Все валюты'}</p><p className="text-muted-foreground">Операций: {incomeCount}</p></CardContent></Card>
          <Card><CardHeader><CardTitle className="flex gap-2 text-red-500"><TrendingDown />Расходы</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{money(expenseAmount)} {currency || 'Все валюты'}</p><p className="text-muted-foreground">Операций: {expenseCount}</p></CardContent></Card>
          <Card><CardHeader><CardTitle>Баланс</CardTitle></CardHeader><CardContent><p className={`text-2xl font-bold ${incomeAmount - expenseAmount >= 0 ? 'text-green-500' : 'text-red-500'}`}>{money(incomeAmount - expenseAmount)} {currency || 'Все валюты'}</p><p className="text-muted-foreground">Доходы минус расходы</p></CardContent></Card>
          <Card><CardHeader><CardTitle>Средняя операция</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{money((incomeAmount + expenseAmount) / Math.max(1, incomeCount + expenseCount))} {currency || 'Все валюты'}</p><p className="text-muted-foreground">За выбранный период</p></CardContent></Card>
        </div>

        <div className="grid gap-5">
          {visibleCharts.includes('dynamics') && <ChartCard title={chartLabels.dynamics} onClose={() => hideChart('dynamics')}><ResponsiveContainer><ComposedChart data={daily}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={axisTick} minTickGap={28} interval="preserveStartEnd" /><YAxis tick={axisTick} width={72} /><Tooltip formatter={money} contentStyle={tooltipStyle} /><Legend wrapperStyle={{ fontSize: 14 }} />{showIncome && <Bar dataKey="income" name="Доходы" fill="#22c55e" />}{showExpense && <Bar dataKey="expense" name="Расходы" fill="#ef4444" />}<Line dataKey="balance" name="Баланс" stroke="#3b82f6" strokeWidth={2} /></ComposedChart></ResponsiveContainer></ChartCard>}
          {visibleCharts.includes('cumulative') && <ChartCard title={chartLabels.cumulative} onClose={() => hideChart('cumulative')}><ResponsiveContainer><AreaChart data={daily}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={axisTick} minTickGap={28} interval="preserveStartEnd" /><YAxis tick={axisTick} width={72} /><Tooltip formatter={money} contentStyle={tooltipStyle} /><Area dataKey="cumulative" name="Баланс" stroke="#3b82f6" fill="#3b82f680" /></AreaChart></ResponsiveContainer></ChartCard>}
          {visibleCharts.includes('departments') && <ChartCard title={chartLabels.departments} onClose={() => hideChart('departments')}><ResponsiveContainer><BarChart data={departments.slice(0, 12)} layout="vertical" margin={{ left: 24, right: 40 }}><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" tick={axisTick} /><YAxis dataKey="name" type="category" width={230} tick={axisTick} /><Tooltip formatter={money} contentStyle={tooltipStyle} /><Legend wrapperStyle={{ fontSize: 14 }} /><Bar dataKey="income" name="Доходы" fill="#22c55e" /><Bar dataKey="expense" name="Расходы" fill="#ef4444" /></BarChart></ResponsiveContainer></ChartCard>}
          {visibleCharts.includes('incomeCategories') && <ChartCard title={chartLabels.incomeCategories} onClose={() => hideChart('incomeCategories')}><ResponsiveContainer><PieChart><Pie data={categories.filter(row => row.income > 0).slice(0, 10)} dataKey="income" nameKey="name" outerRadius={120} label>{categories.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip formatter={money} contentStyle={tooltipStyle} /><Legend wrapperStyle={{ fontSize: 14 }} /></PieChart></ResponsiveContainer></ChartCard>}
          {visibleCharts.includes('expenseCategories') && <ChartCard title={chartLabels.expenseCategories} onClose={() => hideChart('expenseCategories')}><ResponsiveContainer><PieChart><Pie data={categories.filter(row => row.expense > 0).slice(0, 10)} dataKey="expense" nameKey="name" outerRadius={120} label>{categories.map((_, index) => <Cell key={index} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip formatter={money} contentStyle={tooltipStyle} /><Legend wrapperStyle={{ fontSize: 14 }} /></PieChart></ResponsiveContainer></ChartCard>}
          {visibleCharts.includes('dailyNet') && <ChartCard title={chartLabels.dailyNet} onClose={() => hideChart('dailyNet')}><ResponsiveContainer><BarChart data={daily}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={axisTick} minTickGap={28} interval="preserveStartEnd" /><YAxis tick={axisTick} width={72} /><Tooltip formatter={money} contentStyle={tooltipStyle} /><Bar dataKey="balance" name="Баланс">{daily.map((row, index) => <Cell key={index} fill={row.balance >= 0 ? '#22c55e' : '#ef4444'} />)}</Bar></BarChart></ResponsiveContainer></ChartCard>}
        </div>

        <Card><CardHeader><CardTitle className="flex gap-2"><Building2 />Аналитика по отделам</CardTitle></CardHeader><CardContent className="space-y-2">
          {departments.map(row => <div key={row.name} className="grid gap-2 rounded border p-3 sm:grid-cols-3"><strong>{row.name}</strong><span className="text-green-500">Доход: {money(row.income)} {currency}</span><span className="text-red-500">Расход: {money(row.expense)} {currency}</span></div>)}
        </CardContent></Card>
      </div>
    </main>
  );
};

export default PublicAnalytics;
