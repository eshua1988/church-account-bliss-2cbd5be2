import { TransactionType } from '@/types/transaction';

export interface DepartmentRule {
  search_text: string | null;
  department_name: string | null;
  transaction_type: string | null;
}

interface RuleTarget {
  type: TransactionType;
  description?: string | null;
  bankTitle?: string | null;
}

const parseSearchTerms = (text: string | null | undefined) =>
  String(text || '')
    .split(',')
    .map(term => term.trim().toLowerCase())
    .filter(Boolean);

export const findMatchingDepartment = (
  target: RuleTarget,
  rules: DepartmentRule[] = []
): string | null => {
  const title = String(target.bankTitle || '').toLowerCase();
  const desc = String(target.description || '').toLowerCase();

  const rule = rules.find(rule => {
    if (!rule.department_name) return false;
    if (rule.transaction_type && rule.transaction_type !== target.type) return false;

    const terms = parseSearchTerms(rule.search_text);
    return terms.some(term => title.includes(term) || desc.includes(term));
  });

  return rule?.department_name || null;
};
