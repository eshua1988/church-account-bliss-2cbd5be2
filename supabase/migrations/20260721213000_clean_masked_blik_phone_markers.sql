-- Remove masked BLIK phone routing markers from existing expense descriptions.
-- Example: "ZWROT ZA RETREATOD: 48666815427 DO: 485*****979".
UPDATE public.transactions
SET
  description = NULLIF(
    btrim(regexp_replace(description, 'OD:[[:space:]]*[0-9*]+[[:space:]]+DO:[[:space:]]*[0-9*]+([[:space:]]+MOBILE-PAYMENT-C2C)?', ' ', 'gi')),
    ''
  ),
  bank_title = NULLIF(
    btrim(regexp_replace(bank_title, 'OD:[[:space:]]*[0-9*]+[[:space:]]+DO:[[:space:]]*[0-9*]+([[:space:]]+MOBILE-PAYMENT-C2C)?', ' ', 'gi')),
    ''
  )
WHERE type = 'expense'
  AND (
    description ~* 'OD:[[:space:]]*[0-9*]+[[:space:]]+DO:[[:space:]]*[0-9*]+'
    OR bank_title ~* 'OD:[[:space:]]*[0-9*]+[[:space:]]+DO:[[:space:]]*[0-9*]+'
  );
