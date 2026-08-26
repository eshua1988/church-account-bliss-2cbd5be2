import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string;
  icon: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'primary';
  delay?: number;
}

const variantStyles = {
  default: 'bg-card border-border',
  success: 'bg-success/10 border-success/20',
  warning: 'bg-warning/10 border-warning/20',
  primary: 'bg-primary/10 border-primary/20',
};

const iconStyles = {
  default: 'bg-secondary text-muted-foreground',
  success: 'bg-success/20 text-success',
  warning: 'bg-warning/20 text-warning',
  primary: 'bg-primary/20 text-primary',
};

export const StatCard = ({ title, value, icon, variant = 'default', delay = 0 }: StatCardProps) => {
  return (
    <div 
      className={cn(
        'rounded-xl border p-6 shadow-card animate-slide-up transition-all duration-300 hover:shadow-lg hover:-translate-y-1',
        variantStyles[variant]
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold text-foreground">{value}</p>
        </div>
        <div className={cn('p-3 rounded-xl', iconStyles[variant])}>
          {icon}
        </div>
      </div>
    </div>
  );
};
