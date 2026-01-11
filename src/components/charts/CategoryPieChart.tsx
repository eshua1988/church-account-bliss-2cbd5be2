<<<<<<< HEAD
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
=======
import { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
>>>>>>> fd9e39d (fix: sidebar no longer overlaps main content)
import { useTranslation } from '@/contexts/LanguageContext';
import { Card } from '@/components/ui/card';

interface CategoryPieChartProps {
  data: Record<string, number>;
  getCategoryName: (id: string) => string;
  type: 'income' | 'expense';
}

<<<<<<< HEAD
const COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(142.1 76.2% 36.3%)',
  'hsl(221.2 83.2% 53.3%)',
  'hsl(262.1 83.3% 57.8%)',
];

// Deterministic color generator per category name (stable between renders)
const colorFor = (seed: string) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash; // convert to 32bit int
  }
  const h = Math.abs(hash) % 360;
  const s = 70; // saturation
  const l = 45; // lightness
  return `hsl(${h} ${s}% ${l}%)`;
=======
// Generate vibrant random colors
const generateColors = (count: number): string[] => {
  const colors: string[] = [];
  const baseHues = [0, 30, 60, 120, 180, 210, 260, 300, 330];
  
  for (let i = 0; i < count; i++) {
    const hue = baseHues[i % baseHues.length] + (i * 17) % 30;
    const saturation = 65 + (i * 7) % 25;
    const lightness = 50 + (i * 5) % 20;
    colors.push(`hsl(${hue}, ${saturation}%, ${lightness}%)`);
  }
  return colors;
>>>>>>> fd9e39d (fix: sidebar no longer overlaps main content)
};

export const CategoryPieChart = ({ data, getCategoryName, type }: CategoryPieChartProps) => {
  const { t } = useTranslation();

<<<<<<< HEAD
  const chartData = Object.entries(data)
    .filter(([_, value]) => value > 0)
    .map(([category, value]) => ({
      name: getCategoryName(category),
      value,
    }));
=======
  const chartData = useMemo(() => 
    Object.entries(data)
      .filter(([_, value]) => value > 0)
      .map(([category, value]) => ({
        name: getCategoryName(category),
        value,
      })),
    [data, getCategoryName]
  );

  const colors = useMemo(() => generateColors(chartData.length), [chartData.length]);
>>>>>>> fd9e39d (fix: sidebar no longer overlaps main content)

  if (chartData.length === 0) {
    return (
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          {t('categoryDistribution')} ({type === 'income' ? t('income') : t('expenses')})
        </h3>
        <div className="h-[250px] flex items-center justify-center text-muted-foreground">
          {t('noTransactions')}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold text-foreground mb-4">
        {t('categoryDistribution')} ({type === 'income' ? t('income') : t('expenses')})
      </h3>
      <div className="h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
              dataKey="value"
<<<<<<< HEAD
              label={({ cx, cy, midAngle, innerRadius, outerRadius, percent, index, name }) => {
=======
              label={({ cx, cy, midAngle, outerRadius, percent, index, name }) => {
>>>>>>> fd9e39d (fix: sidebar no longer overlaps main content)
                const RADIAN = Math.PI / 180;
                const radius = outerRadius + 25;
                const x = cx + radius * Math.cos(-midAngle * RADIAN);
                const y = cy + radius * Math.sin(-midAngle * RADIAN);
                return (
                  <text 
                    x={x} 
                    y={y} 
<<<<<<< HEAD
                    fill={colorFor(name)}
=======
                    fill={colors[index % colors.length]}
>>>>>>> fd9e39d (fix: sidebar no longer overlaps main content)
                    textAnchor={x > cx ? 'start' : 'end'} 
                    dominantBaseline="central"
                    className="text-xs font-medium"
                  >
                    {`${name} ${(percent * 100).toFixed(0)}%`}
                  </text>
                );
              }}
              labelLine={false}
            >
<<<<<<< HEAD
              {chartData.map((entry, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={colorFor(entry.name)}
=======
              {chartData.map((_, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={colors[index % colors.length]}
>>>>>>> fd9e39d (fix: sidebar no longer overlaps main content)
                  className="stroke-background"
                  strokeWidth={2}
                />
              ))}
            </Pie>
            <Tooltip 
              formatter={(value: number) => value.toLocaleString()}
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
};
