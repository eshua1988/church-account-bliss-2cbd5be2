import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CurrencySelector } from '@/components/CurrencySelector';
import { 
  Currency, 
  TransactionType, 
  TransactionCategory,
  CATEGORY_NAMES,
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  Transaction,
} from '@/types/transaction';
import { PlusCircle, MinusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TransactionFormProps {
  onSubmit: (transaction: Omit<Transaction, 'id' | 'createdAt'>) => void;
}

export const TransactionForm = ({ onSubmit }: TransactionFormProps) => {
  const [type, setType] = useState<TransactionType>('income');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('RUB');
  const [category, setCategory] = useState<TransactionCategory>('offering');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  const categories = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!amount || parseFloat(amount) <= 0) return;

    onSubmit({
      type,
      amount: parseFloat(amount),
      currency,
      category,
      description,
      date: new Date(date),
    });

    // Reset form
    setAmount('');
    setDescription('');
    setDate(new Date().toISOString().split('T')[0]);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 animate-fade-in">
      {/* Transaction Type Toggle */}
      <div className="flex gap-2 p-1 bg-secondary rounded-lg">
        <button
          type="button"
          onClick={() => {
            setType('income');
            setCategory(INCOME_CATEGORIES[0]);
          }}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-md font-semibold transition-all duration-200',
            type === 'income' 
              ? 'bg-success text-success-foreground shadow-md' 
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <PlusCircle className="w-5 h-5" />
          Доход
        </button>
        <button
          type="button"
          onClick={() => {
            setType('expense');
            setCategory(EXPENSE_CATEGORIES[0]);
          }}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-md font-semibold transition-all duration-200',
            type === 'expense' 
              ? 'bg-destructive text-destructive-foreground shadow-md' 
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <MinusCircle className="w-5 h-5" />
          Расход
        </button>
      </div>

      {/* Amount and Currency */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="amount">Сумма</Label>
          <Input
            id="amount"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="text-lg font-semibold"
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Валюта</Label>
          <CurrencySelector value={currency} onChange={setCurrency} />
        </div>
      </div>

      {/* Category */}
      <div className="space-y-2">
        <Label>Категория</Label>
        <Select value={category} onValueChange={(v) => setCategory(v as TransactionCategory)}>
          <SelectTrigger>
            <SelectValue placeholder="Выберите категорию" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {CATEGORY_NAMES[cat]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Date */}
      <div className="space-y-2">
        <Label htmlFor="date">Дата</Label>
        <Input
          id="date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Описание (необязательно)</Label>
        <Textarea
          id="description"
          placeholder="Добавьте описание..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </div>

      {/* Submit Button */}
      <Button 
        type="submit" 
        className={cn(
          'w-full py-6 text-lg font-semibold transition-all duration-200',
          type === 'income' 
            ? 'bg-success hover:bg-success/90' 
            : 'bg-destructive hover:bg-destructive/90'
        )}
      >
        {type === 'income' ? 'Добавить доход' : 'Добавить расход'}
      </Button>
    </form>
  );
};
