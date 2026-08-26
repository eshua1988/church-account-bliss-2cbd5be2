-- Remove variable phone-transfer routing data from stored bank titles.
UPDATE public.transactions
SET
  description = NULLIF(
    trim(regexp_replace(
      regexp_replace(
        description,
        '(^|[^0-9])([0-9]{4}[[:space:]]*)?OD:[[:space:]]*[0-9]+[[:space:]]+DO:[[:space:]]*[0-9]+[[:space:]]+MOBILE-PAYMENT-C2C',
        ' ',
        'gi'
      ),
      'PRZELEW[[:space:]]+NA[[:space:]]+TELEFON[[:space:]]+[0-9*]+\.?',
      ' ',
      'gi'
    )),
    ''
  ),
  bank_title = NULLIF(
    trim(regexp_replace(
      regexp_replace(
        bank_title,
        '(^|[^0-9])([0-9]{4}[[:space:]]*)?OD:[[:space:]]*[0-9]+[[:space:]]+DO:[[:space:]]*[0-9]+[[:space:]]+MOBILE-PAYMENT-C2C',
        ' ',
        'gi'
      ),
      'PRZELEW[[:space:]]+NA[[:space:]]+TELEFON[[:space:]]+[0-9*]+\.?',
      ' ',
      'gi'
    )),
    ''
  )
WHERE
  description ~* '(MOBILE-PAYMENT-C2C|PRZELEW[[:space:]]+NA[[:space:]]+TELEFON)'
  OR bank_title ~* '(MOBILE-PAYMENT-C2C|PRZELEW[[:space:]]+NA[[:space:]]+TELEFON)';
