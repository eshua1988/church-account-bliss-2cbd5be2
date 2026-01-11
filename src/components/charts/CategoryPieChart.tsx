import { useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { useTranslation } from '@/contexts/LanguageContext';
import { Card } from '@/components/ui/card';

interface CategoryPieChartProps {
  data: Record<string, number>;
  getCategoryName: (id: string) => string;
  type: 'income' | 'expense';
}

const COLORS = [
  // ...цвета...
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
};
};

export const CategoryPieChart = ({ data, getCategoryName, type }: CategoryPieChartProps) => {
  const { t } = useTranslation();

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
              label={({ cx, cy, midAngle, outerRadius, percent, index, name }) => {
                const RADIAN = Math.PI / 180;
                const radius = outerRadius + 25;
                const x = cx + radius * Math.cos(-midAngle * RADIAN);
                const y = cy + radius * Math.sin(-midAngle * RADIAN);
                return (
                  <text 
                    x={x} 
                    y={y} 
                    fill={colors[index % colors.length]}
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
              {chartData.map((_, index) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={colors[index % colors.length]}
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
