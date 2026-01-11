import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CurrencySelector } from '@/components/CurrencySelector';
import { Currency, TransactionType, Transaction } from '@/types/transaction';
import { Category } from '@/hooks/useCategories';
import { PlusCircle, MinusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/contexts/LanguageContext';
interface TransactionFormProps {
  onSubmit: (transaction: Omit<Transaction, 'id' | 'createdAt'>) => void;
  incomeCategories: Category[];
  expenseCategories: Category[];
  departments: string[];
}
export const TransactionForm = ({
  onSubmit,
  incomeCategories,
  expenseCategories,
  departments
}: TransactionFormProps) => {
  const { t } = useTranslation();
  const [type, setType] = useState<TransactionType>('income');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('PLN');
  const [categoryId, setCategoryId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  // Expense-specific fields
  const [issuedTo, setIssuedTo] = useState('');
  const [decisionNumber, setDecisionNumber] = useState('');
  const [amountInWords, setAmountInWords] = useState('');
  const [cashierName, setCashierName] = useState('');
  const [departmentName, setDepartmentName] = useState('');
  const categories = type === 'income' ? incomeCategories : expenseCategories;

  // Reset category when type changes or categories update
  useEffect(() => {
    if (categories.length > 0 && !categories.find(c => c.id === categoryId)) {
      setCategoryId(categories[0].id);
    }
  }, [type, categories, categoryId]);
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0 || !categoryId) return;
    const transactionData: Omit<Transaction, 'id' | 'createdAt'> = {
      type,
      amount: parseFloat(amount),
      currency,
      category: categoryId as any,
      description,
      date: new Date(date)
    };

    // Add expense-specific fields only for expenses
    if (type === 'expense') {
      transactionData.issuedTo = issuedTo || undefined;
      transactionData.decisionNumber = decisionNumber || undefined;
      transactionData.amountInWords = amountInWords || undefined;
      transactionData.cashierName = cashierName || undefined;
      transactionData.departmentName = departmentName || undefined;
    }
    onSubmit(transactionData);

    // Reset form
    setAmount('');
    setDescription('');
    setDate(new Date().toISOString().split('T')[0]);
    setIssuedTo('');
    setDecisionNumber('');
    setAmountInWords('');
    setCashierName('');
    setDepartmentName('');
  };
  return <form onSubmit={handleSubmit} className="space-y-6 animate-fade-in">
      {/* Transaction Type Toggle */}
      <div className="flex gap-2 p-1 bg-secondary rounded-lg">
        <button type="button" onClick={() => setType('income')} className={cn('flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-md font-semibold transition-all duration-200', type === 'income' ? 'bg-success text-success-foreground shadow-md' : 'text-muted-foreground hover:text-foreground')}>
          <PlusCircle className="w-5 h-5" />
          {t('incomeType')}
        </button>
        <button type="button" onClick={() => setType('expense')} className={cn('flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-md font-semibold transition-all duration-200', type === 'expense' ? 'bg-destructive text-destructive-foreground shadow-md' : 'text-muted-foreground hover:text-foreground')}>
          <MinusCircle className="w-5 h-5" />
          {t('expense')}
        </button>
      </div>

      {/* Amount and Currency */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="amount">{t('amount')}</Label>
          <Input id="amount" type="number" step="0.01" min="0" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} className="text-lg font-semibold" required />
        </div>
        <div className="space-y-2">
          <Label>{t('currency')}</Label>
          <CurrencySelector value={currency} onChange={setCurrency} />
        </div>
      </div>

      {/* Category */}
      <div className="space-y-2">
        <Label>{t('category')}</Label>
        {categories.length === 0 ? <p className="text-sm text-muted-foreground py-2">
            {t('noCategoriesWarning')}
          </p> : <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger>
              <SelectValue placeholder={t('selectCategory')} />
            </SelectTrigger>
            <SelectContent>
              {categories.map(cat => <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>)}
            </SelectContent>
          </Select>}
      </div>

      {/* Date */}
      <div className="space-y-2">
        <Label htmlFor="date">{t('date')}</Label>
        <Input id="date" type="date" value={date} onChange={e => setDate(e.target.value)} required />
      </div>

      {/* Expense-specific fields */}
      {type === 'expense' && <div className="space-y-4 p-4 bg-muted/50 rounded-lg border border-border">
          <div className="space-y-2">
            <Label>{t('departmentName')}</Label>
            <Select value={departmentName} onValueChange={setDepartmentName}>
              <SelectTrigger>
                <SelectValue placeholder={t('selectDepartment')} />
              </SelectTrigger>
              <SelectContent>
                {departments.map((dept) => (
                  <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="issuedTo">{t('issuedTo')}</Label>
            <Input id="issuedTo" placeholder={t('enterIssuedTo')} value={issuedTo} onChange={e => setIssuedTo(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="decisionNumber">{t('decisionNumber')}</Label>
            <Input id="decisionNumber" placeholder={t('enterDecisionNumber')} value={decisionNumber} onChange={e => setDecisionNumber(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="amountInWords">{t('amountInWords')}</Label>
            <Input id="amountInWords" placeholder={t('enterAmountInWords')} value={amountInWords} onChange={e => setAmountInWords(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cashierName">{t('cashierName')}</Label>
            <Input id="cashierName" placeholder={t('enterCashierName')} value={cashierName} onChange={e => setCashierName(e.target.value)} />
          </div>
        </div>}

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">{t('description')}</Label>
        <Textarea id="description" placeholder={t('addDescription')} value={description} onChange={e => setDescription(e.target.value)} rows={3} />
      </div>

      {/* Submit Button */}
      <Button type="submit" disabled={categories.length === 0} className={cn('w-full py-6 text-lg font-semibold transition-all duration-200', type === 'income' ? 'bg-success hover:bg-success/90' : 'bg-destructive hover:bg-destructive/90')}>
        {type === 'income' ? t('addIncome') : t('addExpense')}
      </Button>
    </form>;
};