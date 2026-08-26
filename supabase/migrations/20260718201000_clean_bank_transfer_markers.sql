-- Remove technical Enable Banking direction markers from already imported titles.
UPDATE public.transactions
SET
  description = NULLIF(
    trim(regexp_replace(description, '(^|[[:space:]])TRANSFER[-_[:space:]]?(IN|OUT)([[:space:]]|$)', ' ', 'gi')),
    ''
  ),
  bank_title = NULLIF(
    trim(regexp_replace(bank_title, '(^|[[:space:]])TRANSFER[-_[:space:]]?(IN|OUT)([[:space:]]|$)', ' ', 'gi')),
    ''
  )
WHERE
  description ~* '(^|[[:space:]])TRANSFER[-_[:space:]]?(IN|OUT)([[:space:]]|$)'
  OR bank_title ~* '(^|[[:space:]])TRANSFER[-_[:space:]]?(IN|OUT)([[:space:]]|$)';
