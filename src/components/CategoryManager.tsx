import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TransactionType } from '@/types/transaction';
import { Category } from '@/hooks/useCategories';
import { Plus, Trash2, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/contexts/LanguageContext';

interface CategoryManagerProps {
  categories: Category[];
  onAdd: (name: string, type: TransactionType) => void;
  onDelete: (id: string) => void;
}

export const CategoryManager = ({ categories, onAdd, onDelete }: CategoryManagerProps) => {
  const { t } = useTranslation();
  const [activeType, setActiveType] = useState<TransactionType>('income');
  const [newCategoryName, setNewCategoryName] = useState('');

  const filteredCategories = categories.filter(c => c.type === activeType);

  const handleAdd = () => {
    if (newCategoryName.trim()) {
      onAdd(newCategoryName.trim(), activeType);
      setNewCategoryName('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <div className="space-y-6">
      {/* Type Toggle */}
      <div className="flex gap-2 p-1 bg-secondary rounded-lg">
        <button
          type="button"
          onClick={() => setActiveType('income')}
          className={cn(
            'flex-1 py-2.5 px-4 rounded-md font-semibold transition-all duration-200',
            activeType === 'income'
              ? 'bg-success text-success-foreground shadow-md'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t('income')}
        </button>
        <button
          type="button"
          onClick={() => setActiveType('expense')}
          className={cn(
            'flex-1 py-2.5 px-4 rounded-md font-semibold transition-all duration-200',
            activeType === 'expense'
              ? 'bg-destructive text-destructive-foreground shadow-md'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t('expenses')}
        </button>
      </div>

      {/* Add New Category */}
      <div className="space-y-2">
        <Label>{t('addCategory')}</Label>
        <div className="flex gap-2">
          <Input
            placeholder={t('categoryName')}
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button
            onClick={handleAdd}
            disabled={!newCategoryName.trim()}
            className={cn(
              activeType === 'income'
                ? 'bg-success hover:bg-success/90'
                : 'bg-destructive hover:bg-destructive/90'
            )}
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Categories List */}
      <div className="space-y-2">
        <Label>
          {activeType === 'income' ? t('incomeCategories') : t('expenseCategories')}
        </Label>
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {filteredCategories.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t('noCategories')}
            </p>
          ) : (
            filteredCategories.map((category) => (
              <div
                key={category.id}
                className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg border border-border"
              >
                <div className="flex items-center gap-2">
                  <Tag className={cn(
                    'w-4 h-4',
                    activeType === 'income' ? 'text-success' : 'text-destructive'
                  )} />
                  <span className="font-medium text-foreground">{category.name}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDelete(category.id)}
                  className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
