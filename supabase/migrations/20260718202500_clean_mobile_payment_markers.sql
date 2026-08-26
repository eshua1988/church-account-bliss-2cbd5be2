-- Remove the technical PKO/Enable Banking channel marker from stored titles.
UPDATE public.transactions
SET
  description = NULLIF(
    trim(regexp_replace(
      description,
      '(^|[[:space:]])MOBILE-PAYMENT-C2C-EXTERNAL([[:space:]]|$)',
      ' ',
      'gi'
    )),
    ''
  ),
  bank_title = NULLIF(
    trim(regexp_replace(
      bank_title,
      '(^|[[:space:]])MOBILE-PAYMENT-C2C-EXTERNAL([[:space:]]|$)',
      ' ',
      'gi'
    )),
    ''
  )
WHERE
  description ~* '(^|[[:space:]])MOBILE-PAYMENT-C2C-EXTERNAL([[:space:]]|$)'
  OR bank_title ~* '(^|[[:space:]])MOBILE-PAYMENT-C2C-EXTERNAL([[:space:]]|$)';
