import { useState } from 'react';
import { LanguageSelector } from './LanguageSelector';
import { useIsMobile } from '@/hooks/use-mobile';
import { Church, ChevronLeft, ChevronRight, Menu, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/contexts/LanguageContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { TransactionForm } from './TransactionForm';
import { Transaction } from '@/types/transaction';
import { Category } from '@/hooks/useSupabaseCategories';

interface HeaderProps {
  collapsed?: boolean;
  onToggleSidebar?: () => void;
  onOpenMobileMenu?: () => void;
  onAddTransaction?: (transaction: Omit<Transaction, 'id' | 'createdAt'>) => Promise<void>;
  incomeCategories?: Category[];
  expenseCategories?: Category[];
}

export const Header = ({ 
  collapsed, 
  onToggleSidebar, 
  onOpenMobileMenu,
  onAddTransaction,
  incomeCategories = [],
  expenseCategories = [],
}: HeaderProps) => {
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  const [isTransactionDialogOpen, setIsTransactionDialogOpen] = useState(false);

  const handleAddTransaction = async (transaction: Omit<Transaction, 'id' | 'createdAt'>) => {
    if (onAddTransaction) {
      await onAddTransaction(transaction);
      setIsTransactionDialogOpen(false);
    }
  };
  
  return (
    <header className="bg-card border-b border-border shadow-sm">
      <div className="container mx-auto py-3 px-4">
        <div className="flex items-center justify-between">
          {/* Left: Logo and title */}
          <div className="flex items-center gap-3">
            {isMobile ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={onOpenMobileMenu}
                className="flex-shrink-0"
              >
                <Menu className="w-5 h-5" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleSidebar}
                className="flex-shrink-0"
              >
                {collapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronLeft className="w-4 h-4" />
                )}
              </Button>
            )}
            <div className="w-10 h-10 rounded-xl gradient-primary shadow-glow flex items-center justify-center flex-shrink-0">
              <Church className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="hidden sm:block min-w-0">
              <h1 className="font-bold text-foreground text-sm leading-tight">{t('appTitle')}</h1>
              <p className="text-muted-foreground text-xs leading-tight truncate">{t('appSubtitle')}</p>
            </div>
          </div>
          
          {/* Right: Controls */}
          <div className="flex items-center gap-1 sm:gap-2">
            {onAddTransaction && (
              <Dialog open={isTransactionDialogOpen} onOpenChange={setIsTransactionDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gradient-primary text-primary-foreground font-semibold shadow-glow hover:shadow-lg transition-all duration-200">
                    <Plus className="w-4 h-4 sm:mr-2" />
                    <span className="hidden sm:inline">{t('addTransaction')}</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px] max-h-[90vh] w-[95vw] overflow-hidden flex flex-col">
                  <DialogHeader><DialogTitle>{t('newTransaction')}</DialogTitle></DialogHeader>
                  <div className="overflow-y-auto flex-1 pr-2">
                    <TransactionForm 
                      onSubmit={handleAddTransaction} 
                      incomeCategories={incomeCategories} 
                      expenseCategories={expenseCategories} 
                    />
                  </div>
                </DialogContent>
              </Dialog>
            )}
            <LanguageSelector />
          </div>
        </div>
      </div>
    </header>
  );
};