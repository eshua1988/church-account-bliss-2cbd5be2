-- Enable REPLICA IDENTITY FULL for Realtime to work correctly on all events
-- Without this, UPDATE and DELETE events may not carry old/new row data
ALTER TABLE public.transactions REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER TABLE public.categories REPLICA IDENTITY FULL;
ALTER TABLE public.profiles REPLICA IDENTITY FULL;
ALTER TABLE public.shared_payout_links REPLICA IDENTITY FULL;

-- Ensure both tables are in Realtime publication (safe to re-add if already present)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.categories;
  EXCEPTION WHEN others THEN NULL; END;
END $$;
