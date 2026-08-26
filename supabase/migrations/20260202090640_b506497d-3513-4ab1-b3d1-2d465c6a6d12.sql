-- Security fixes for public payout system

-- 1. Add CHECK constraints on transactions table for data validation
ALTER TABLE public.transactions
ADD CONSTRAINT transactions_amount_positive CHECK (amount > 0),
ADD CONSTRAINT transactions_amount_max CHECK (amount <= 10000000),
ADD CONSTRAINT transactions_currency_valid CHECK (currency IN ('PLN', 'EUR', 'USD', 'UAH', 'RUB', 'BYN'));

-- 2. Add text length limits using triggers (CHECK constraints can't use functions for variable-length text)
CREATE OR REPLACE FUNCTION public.validate_transaction_text_lengths()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.description IS NOT NULL AND length(NEW.description) > 500 THEN
    RAISE EXCEPTION 'Description exceeds maximum length of 500 characters';
  END IF;
  IF NEW.issued_to IS NOT NULL AND length(NEW.issued_to) > 500 THEN
    RAISE EXCEPTION 'Issued_to exceeds maximum length of 500 characters';
  END IF;
  IF NEW.amount_in_words IS NOT NULL AND length(NEW.amount_in_words) > 500 THEN
    RAISE EXCEPTION 'Amount_in_words exceeds maximum length of 500 characters';
  END IF;
  IF NEW.cashier_name IS NOT NULL AND length(NEW.cashier_name) > 500 THEN
    RAISE EXCEPTION 'Cashier_name exceeds maximum length of 500 characters';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER validate_transaction_text_lengths_trigger
BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.validate_transaction_text_lengths();

-- 3. Drop the overly permissive public SELECT policy on shared_payout_links
-- This policy was exposing tokens and owner_user_ids to everyone
DROP POLICY IF EXISTS "Anyone can read active links by token" ON public.shared_payout_links;

-- 4. Drop the public INSERT policy on transactions (now handled by edge function)
DROP POLICY IF EXISTS "Public can insert transactions via shared link" ON public.transactions;

-- 5. Drop the public SELECT policy on categories for shared links (now handled by edge function)
DROP POLICY IF EXISTS "Public can read categories for shared links" ON public.categories;