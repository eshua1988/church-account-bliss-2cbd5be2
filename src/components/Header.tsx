import { Church } from 'lucide-react';

export const Header = () => {
  return (
    <header className="bg-card border-b border-border shadow-sm">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl gradient-primary shadow-glow">
            <Church className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Церковная бухгалтерия</h1>
            <p className="text-sm text-muted-foreground">Учёт финансов общины</p>
          </div>
        </div>
      </div>
    </header>
  );
};
