import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TransactionType } from '@/types/transaction';
import { Category } from '@/hooks/useCategories';
import { Plus, Trash2, Tag, Pencil, Check, X, GripVertical, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/contexts/LanguageContext';

interface CategoryManagerProps {
  categories: Category[];
  onAdd: (name: string, type: TransactionType) => void;
  onDelete: (id: string) => void;
  onUpdate?: (id: string, name: string) => void;
  onReorder?: (type: TransactionType, fromIndex: number, toIndex: number) => void;
}

export const CategoryManager = ({ categories, onAdd, onDelete, onUpdate, onReorder }: CategoryManagerProps) => {
  const { t } = useTranslation();
  const [activeType, setActiveType] = useState<TransactionType>('income');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

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

  const startEdit = (category: Category) => {
    setEditingId(category.id);
    setEditingName(category.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  const saveEdit = () => {
    if (editingId && editingName.trim() && onUpdate) {
      onUpdate(editingId, editingName.trim());
    }
    cancelEdit();
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  };

  const moveUp = (index: number) => {
    if (index > 0 && onReorder) {
      onReorder(activeType, index, index - 1);
    }
  };

  const moveDown = (index: number) => {
    if (index < filteredCategories.length - 1 && onReorder) {
      onReorder(activeType, index, index + 1);
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
            filteredCategories.map((category, index) => (
              <div
                key={category.id}
                className="flex items-center justify-between p-3 bg-secondary/50 rounded-lg border border-border gap-2"
              >
                {editingId === category.id ? (
                  <>
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={handleEditKeyDown}
                      className="flex-1"
                      autoFocus
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={saveEdit}
                      className="h-8 w-8 text-success hover:text-success hover:bg-success/10"
                    >
                      <Check className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={cancelEdit}
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
                      <Tag className={cn(
                        'w-4 h-4 shrink-0',
                        activeType === 'income' ? 'text-success' : 'text-destructive'
                      )} />
                      <span className="font-medium text-foreground truncate">{category.name}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {onReorder && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => moveUp(index)}
                            disabled={index === 0}
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          >
                            <ArrowUp className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => moveDown(index)}
                            disabled={index === filteredCategories.length - 1}
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          >
                            <ArrowDown className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      {onUpdate && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => startEdit(category)}
                          className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onDelete(category.id)}
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};