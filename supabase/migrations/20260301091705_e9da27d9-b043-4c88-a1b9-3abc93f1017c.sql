-- Remove overly permissive anon policies on notifications (not needed - edge function uses service role)
DROP POLICY IF EXISTS "Anon can read notifications for pdf path update" ON public.notifications;
DROP POLICY IF EXISTS "Anon can update notification metadata" ON public.notifications;
