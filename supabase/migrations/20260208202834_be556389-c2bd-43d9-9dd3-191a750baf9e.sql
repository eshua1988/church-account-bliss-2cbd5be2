-- Create table for Telegram user connections
CREATE TABLE public.telegram_users (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  telegram_chat_id BIGINT NOT NULL UNIQUE,
  telegram_username TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.telegram_users ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own telegram connections"
ON public.telegram_users
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own telegram connections"
ON public.telegram_users
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own telegram connections"
ON public.telegram_users
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own telegram connections"
ON public.telegram_users
FOR DELETE
USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_telegram_users_updated_at
BEFORE UPDATE ON public.telegram_users
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create table for tracking users who skipped images
CREATE TABLE public.payout_image_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_user_id UUID NOT NULL,
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE CASCADE,
  submitter_name TEXT NOT NULL,
  telegram_chat_id BIGINT,
  skipped_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.payout_image_tracking ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own image tracking"
ON public.payout_image_tracking
FOR SELECT
USING (auth.uid() = owner_user_id);

CREATE POLICY "Service role can insert image tracking"
ON public.payout_image_tracking
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Users can delete their own image tracking"
ON public.payout_image_tracking
FOR DELETE
USING (auth.uid() = owner_user_id);