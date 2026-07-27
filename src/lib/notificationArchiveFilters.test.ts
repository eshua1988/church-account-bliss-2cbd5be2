import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Notification } from '@/hooks/useNotifications';
import { getArchivedNotifications } from './notificationArchiveFilters.ts';

const notification = (
  id: string,
  type: string,
  metadata: Notification['metadata'],
): Notification => ({
  id,
  user_id: 'user-1',
  title: id,
  message: '',
  type,
  is_read: true,
  metadata,
  created_at: '2026-07-27T00:00:00.000Z',
});

describe('getArchivedNotifications', () => {
  it('includes archived income and expense notifications', () => {
    const archivedIncome = notification('income', 'deposit', {
      document_type: 'deposit',
      archive_type: 'income',
      archived_at: '2026-07-27T00:00:00.000Z',
    });
    const archivedExpense = notification('expense', 'payout', {
      archive_type: 'expense',
      archived_at: '2026-07-27T00:00:00.000Z',
    });
    const activeIncome = notification('active-income', 'deposit', {
      document_type: 'deposit',
    });

    assert.deepEqual(getArchivedNotifications([
      archivedIncome,
      archivedExpense,
      activeIncome,
    ]), [archivedIncome, archivedExpense]);
  });
});
