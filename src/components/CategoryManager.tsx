import { useState, useMemo, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TransactionType, Transaction } from '@/types/transaction';
import { Category } from '@/hooks/useSupabaseCategories';
import { Plus, Trash2, Tag, Pencil, Check, X, GripVertical, ArrowUp, ArrowDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/contexts/LanguageContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';

interface DepartmentRule {
  id: string;
  search_text: string;
  department_name: string;
  transaction_type: string;
  created_at: string;
}

interface CategoryManagerProps {
  categories: Category[];
  onAdd: (name: string, type: TransactionType) => void | Promise<void>;
  onDelete: (id: string) => void;
  onUpdate?: (id: string, name: string) => void;
  onReorder?: (type: TransactionType, fromIndex: number, toIndex: number) => void;
  transactions?: Transaction[];
  onBulkUpdateDepartment?: (ids: string[], departmentName: string) => Promise<void>;
}

export const CategoryManager = ({ categories, onAdd, onDelete, onUpdate, onReorder, transactions = [], onBulkUpdateDepartment }: CategoryManagerProps) => {
  const { t } = useTranslation();
  const [activeType, setActiveType] = useState<TransactionType | 'extension'>('income');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [extDepartment, setExtDepartment] = useState('');
  const [extSearchText, setExtSearchText] = useState('');
  const [extType, setExtType] = useState<'income' | 'expense'>('expense');
  const [extApplying, setExtApplying] = useState(false);
  const [extResult, setExtResult] = useState<string | null>(null);
  const [rules, setRules] = useState<DepartmentRule[]>([]);

  const loadRules = useCallback(async () => {
    const { data } = await supabase.from('department_rules').select('*').order('created_at', { ascending: false });
    if (data) setRules(data as unknown as DepartmentRule[]);
  }, []);

  useEffect(() => { loadRules(); }, [loadRules]);

  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editRuleText, setEditRuleText] = useState('');
  const [editRuleDept, setEditRuleDept] = useState('');
  const [editRuleType, setEditRuleType] = useState<'income' | 'expense'>('expense');

  const deleteRule = async (id: string) => {
    await supabase.from('department_rules').delete().eq('id', id);
    setRules(prev => prev.filter(r => r.id !== id));
  };

  const startEditRule = (rule: DepartmentRule) => {
    setEditingRuleId(rule.id);
    setEditRuleText(rule.search_text);
    setEditRuleDept(rule.department_name);
    setEditRuleType(rule.transaction_type as 'income' | 'expense');
  };

  const saveRule = async () => {
    if (!editingRuleId || !editRuleText.trim() || !editRuleDept || !onBulkUpdateDepartment) return;
    await supabase.from('department_rules').update({
      search_text: editRuleText.trim(),
      department_name: editRuleDept,
      transaction_type: editRuleType,
    } as any).eq('id', editingRuleId);
    // Apply updated rule to matching transactions
    const search = editRuleText.trim().toLowerCase();
    const matching = transactions.filter(tx => {
      if (editRuleType !== tx.type) return false;
      const title = (tx.bankTitle || '').toLowerCase();
      const desc = (tx.description || '').toLowerCase();
      return title.includes(search) || desc.includes(search);
    });
    if (matching.length > 0) {
      await onBulkUpdateDepartment(matching.map(tx => tx.id), editRuleDept);
    }
    setEditingRuleId(null);
    await loadRules();
  };

  const filteredCategories = categories.filter(c => c.type === (activeType === 'extension' ? 'expense' : activeType));

  const allDepartments = categories.map(c => c.name);

  const extMatches = useMemo(() => {
    if (!extSearchText.trim()) return [];
    const search = extSearchText.trim().toLowerCase();
    return transactions.filter(tx => {
      if (extType !== tx.type) return false;
      const title = (tx.bankTitle || '').toLowerCase();
      const desc = (tx.description || '').toLowerCase();
      return title.includes(search) || desc.includes(search);
    });
  }, [extSearchText, extType, transactions]);

  const handleExtApply = async () => {
    if (!onBulkUpdateDepartment || !extDepartment || extMatches.length === 0) return;
    setExtApplying(true);
    try {
      await onBulkUpdateDepartment(extMatches.map(t => t.id), extDepartment);
      // Save rule to DB
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await supabase.from('department_rules').insert({
          user_id: session.user.id,
          search_text: extSearchText.trim(),
          department_name: extDepartment,
          transaction_type: extType,
        } as any);
        await loadRules();
      }
      setExtResult(`Обновлено ${extMatches.length} транзакций → ${extDepartment}`);
      setExtSearchText('');
    } catch {
      setExtResult('Ошибка при обновлении');
    } finally {
      setExtApplying(false);
    }
  };

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of transactions) {
      counts[t.category] = (counts[t.category] || 0) + 1;
    }
    return counts;
  }, [transactions]);

  const handleAdd = async () => {
    const names = newCategoryName
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    if (names.length === 0) return;
    for (const name of names) {
      await onAdd(name, activeType);
    }
    setNewCategoryName('');
  };

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await handleAdd();
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
        <button
          type="button"
          onClick={() => setActiveType('extension')}
          className={cn(
            'flex-1 py-2.5 px-4 rounded-md font-semibold transition-all duration-200',
            activeType === 'extension'
              ? 'bg-primary text-primary-foreground shadow-md'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Расширение
        </button>
      </div>

      {activeType === 'extension' ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Тип транзакции</Label>
            <Select value={extType} onValueChange={(v) => setExtType(v as 'income' | 'expense')}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="income">{t('income')}</SelectItem>
                <SelectItem value="expense">{t('expenses')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Название отдела</Label>
            <Select value={extDepartment} onValueChange={setExtDepartment}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Выберите отдел..." />
              </SelectTrigger>
              <SelectContent>
                {allDepartments.map(name => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Текст для поиска в титуле / описании</Label>
            <div className="flex gap-2">
              <Input
                placeholder="Введите текст для поиска..."
                value={extSearchText}
                onChange={(e) => { setExtSearchText(e.target.value); setExtResult(null); }}
                className="flex-1"
              />
              <Button
                onClick={handleExtApply}
                disabled={!extDepartment || !extSearchText.trim() || extMatches.length === 0 || extApplying}
              >
                <Search className="w-4 h-4 mr-1" />
                Применить
              </Button>
            </div>
          </div>

          {extSearchText.trim() && (
            <div className="text-sm text-muted-foreground">
              Найдено: <span className="font-medium text-foreground">{extMatches.length}</span> транзакций
            </div>
          )}

          {extResult && (
            <div className="text-sm font-medium text-success">{extResult}</div>
          )}

          {rules.length > 0 && (
            <div className="space-y-1 mt-4">
              <Label className="text-xs text-muted-foreground">Сохранённые правила (авто-применение)</Label>
              <div className="space-y-1 max-h-[300px] overflow-y-auto">
                {rules.map(rule => (
                  editingRuleId === rule.id ? (
                    <div key={rule.id} className="space-y-2 p-2 bg-muted/50 rounded border border-primary/30">
                      <Input
                        value={editRuleText}
                        onChange={(e) => setEditRuleText(e.target.value)}
                        className="h-7 text-xs"
                        placeholder="Текст поиска"
                      />
                      <Select value={editRuleDept} onValueChange={setEditRuleDept}>
                        <SelectTrigger className="h-7 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {allDepartments.map(name => (
                            <SelectItem key={name} value={name}>{name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-2">
                        <Select value={editRuleType} onValueChange={(v) => setEditRuleType(v as 'income' | 'expense')}>
                          <SelectTrigger className="h-7 text-xs flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="income">{t('income')}</SelectItem>
                            <SelectItem value="expense">{t('expenses')}</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={saveRule}>
                          <Check className="w-3 h-3 text-success" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingRuleId(null)}>
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div key={rule.id} className="flex items-center justify-between text-xs p-2 bg-muted/50 rounded">
                      <span className="truncate flex-1">
                        «{rule.search_text}» → <span className="font-medium">{rule.department_name}</span>
                        <span className="text-muted-foreground ml-1">({rule.transaction_type === 'income' ? 'доход' : 'расход'})</span>
                      </span>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 ml-1" onClick={() => startEditRule(rule)}>
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => deleteRule(rule.id)}>
                        <Trash2 className="w-3 h-3 text-destructive" />
                      </Button>
                    </div>
                  )
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
      <>

      {/* Add New Category */}
      <div className="space-y-2">
        <Label>{t('addCategory')}</Label>
        <div className="flex gap-2">
          <Input
            placeholder={t('categoryName') + ' (можно несколько через запятую)'}
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
                      <span className="text-xs text-muted-foreground shrink-0">({categoryCounts[category.id] || 0})</span>
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
      </>
      )}
    </div>
  );
};