-- BRIN stays tiny and accelerates wide date-range scans on very large tables.
CREATE INDEX IF NOT EXISTS transactions_date_brin_idx
  ON public.transactions USING brin (date) WITH (pages_per_range = 64);

-- Native RANGE partitioning cannot be switched on in-place while
-- temp_signatures references transactions(id). A partitioned primary key would
-- have to include date, so the FK contract must first migrate from
-- transaction_id to (transaction_id, transaction_date). Keep this migration
-- non-destructive; it prepares production for the later online table swap.
COMMENT ON INDEX public.transactions_date_brin_idx IS
  'Preparation for date partitioning; supports large date scans before the FK-compatible online table swap.';
