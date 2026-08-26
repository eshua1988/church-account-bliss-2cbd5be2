ALTER TABLE public.registration_events
  ADD COLUMN IF NOT EXISTS form_fields jsonb NOT NULL DEFAULT
    '[{"id":"first_name","label":"Имя","type":"text","required":true},{"id":"last_name","label":"Фамилия","type":"text","required":true},{"id":"phone","label":"Номер телефона","type":"phone","required":true},{"id":"email","label":"Email","type":"email","required":true}]'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS price numeric(12,2),
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'PLN',
  ADD COLUMN IF NOT EXISTS payment_instructions text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_url text,
  ADD COLUMN IF NOT EXISTS telegram_bot_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'not_required';

ALTER TABLE public.event_registrations
  DROP CONSTRAINT IF EXISTS event_registrations_payment_status_check;
ALTER TABLE public.event_registrations
  ADD CONSTRAINT event_registrations_payment_status_check
  CHECK (payment_status IN ('not_required', 'pending', 'paid'));

CREATE TABLE IF NOT EXISTS public.event_registration_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.registration_events(id) ON DELETE CASCADE,
  bot_id uuid REFERENCES public.telegram_users(id) ON DELETE SET NULL,
  telegram_user_id bigint NOT NULL,
  telegram_chat_id bigint NOT NULL,
  current_field_index integer NOT NULL DEFAULT 0,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  telegram_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, telegram_user_id)
);

ALTER TABLE public.event_registration_sessions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_event_registration_sessions_user
  ON public.event_registration_sessions (telegram_user_id, updated_at DESC);

DROP FUNCTION IF EXISTS public.register_telegram_for_event(
  uuid, uuid, bigint, bigint, text, text, text
);

CREATE OR REPLACE FUNCTION public.register_telegram_for_event(
  target_event_id uuid,
  target_owner_user_id uuid,
  target_telegram_user_id bigint,
  target_telegram_chat_id bigint,
  target_first_name text,
  target_last_name text,
  target_username text,
  target_answers jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_event public.registration_events%ROWTYPE;
  registered_count integer;
  inserted_id uuid;
  initial_payment_status text;
BEGIN
  SELECT * INTO selected_event
  FROM public.registration_events
  WHERE id = target_event_id
    AND user_id = target_owner_user_id
    AND is_published = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.event_registrations
    WHERE event_id = target_event_id
      AND telegram_user_id = target_telegram_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'already_registered');
  END IF;

  SELECT count(*) INTO registered_count
  FROM public.event_registrations
  WHERE event_id = target_event_id;

  IF selected_event.capacity IS NOT NULL AND registered_count >= selected_event.capacity THEN
    RETURN jsonb_build_object('success', false, 'code', 'full');
  END IF;

  initial_payment_status := CASE
    WHEN selected_event.payment_required THEN 'pending'
    ELSE 'not_required'
  END;

  INSERT INTO public.event_registrations (
    event_id, telegram_user_id, telegram_chat_id, first_name, last_name,
    username, answers, payment_status
  ) VALUES (
    target_event_id, target_telegram_user_id, target_telegram_chat_id,
    target_first_name, target_last_name, target_username,
    COALESCE(target_answers, '{}'::jsonb), initial_payment_status
  )
  RETURNING id INTO inserted_id;

  DELETE FROM public.event_registration_sessions
  WHERE event_id = target_event_id
    AND telegram_user_id = target_telegram_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'registered',
    'registration_id', inserted_id,
    'title', selected_event.title,
    'confirmation_text', selected_event.confirmation_text,
    'payment_required', selected_event.payment_required,
    'price', selected_event.price,
    'currency', selected_event.currency,
    'payment_instructions', selected_event.payment_instructions,
    'payment_url', selected_event.payment_url,
    'registered_count', registered_count + 1,
    'capacity', selected_event.capacity
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_telegram_for_event(
  uuid, uuid, bigint, bigint, text, text, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_telegram_for_event(
  uuid, uuid, bigint, bigint, text, text, text, jsonb
) TO service_role;
