-- Remove technical C2C routing and ATM transaction markers from stored bank titles.
UPDATE public.transactions
SET
  description = NULLIF(
    trim(regexp_replace(
      regexp_replace(
        description,
        'OD:[[:space:]]*[0-9]+[[:space:]]+DO:[[:space:]]*[0-9]+[[:space:]]+MOBILE-PAYMENT-C2C',
        ' ',
        'gi'
      ),
      '[0-9]{4}[[:space:]]+[0-9]{10,}[[:space:]]+MOBILE-PAYMENT-ATM-TX-CODE',
      ' ',
      'gi'
    )),
    ''
  ),
  bank_title = NULLIF(
    trim(regexp_replace(
      regexp_replace(
        bank_title,
        'OD:[[:space:]]*[0-9]+[[:space:]]+DO:[[:space:]]*[0-9]+[[:space:]]+MOBILE-PAYMENT-C2C',
        ' ',
        'gi'
      ),
      '[0-9]{4}[[:space:]]+[0-9]{10,}[[:space:]]+MOBILE-PAYMENT-ATM-TX-CODE',
      ' ',
      'gi'
    )),
    ''
  )
WHERE
  description ~* 'MOBILE-PAYMENT-(C2C|ATM-TX-CODE)'
  OR bank_title ~* 'MOBILE-PAYMENT-(C2C|ATM-TX-CODE)';
