CREATE TABLE IF NOT EXISTS public.registration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '',
  starts_at timestamptz,
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  button_text text NOT NULL DEFAULT 'Зарегистрироваться',
  confirmation_text text NOT NULL DEFAULT 'Регистрация подтверждена!',
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS registration_events_user_published_idx
  ON public.registration_events (user_id, is_published, starts_at);

CREATE TABLE IF NOT EXISTS public.event_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.registration_events(id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL,
  telegram_chat_id bigint NOT NULL,
  first_name text,
  last_name text,
  username text,
  registered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, telegram_user_id)
);

CREATE INDEX IF NOT EXISTS event_registrations_event_idx
  ON public.event_registrations (event_id, registered_at);

ALTER TABLE public.registration_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage registration events" ON public.registration_events;
CREATE POLICY "Owners manage registration events"
  ON public.registration_events
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Owners view event registrations" ON public.event_registrations;
CREATE POLICY "Owners view event registrations"
  ON public.event_registrations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.registration_events event
      WHERE event.id = event_registrations.event_id
        AND event.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners delete event registrations" ON public.event_registrations;
CREATE POLICY "Owners delete event registrations"
  ON public.event_registrations
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.registration_events event
      WHERE event.id = event_registrations.event_id
        AND event.user_id = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS update_registration_events_updated_at ON public.registration_events;
CREATE TRIGGER update_registration_events_updated_at
  BEFORE UPDATE ON public.registration_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.register_telegram_for_event(
  target_event_id uuid,
  target_owner_user_id uuid,
  target_telegram_user_id bigint,
  target_telegram_chat_id bigint,
  target_first_name text DEFAULT NULL,
  target_last_name text DEFAULT NULL,
  target_username text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_event public.registration_events%ROWTYPE;
  registrations_count integer;
BEGIN
  SELECT *
  INTO target_event
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
    RETURN jsonb_build_object(
      'success', true,
      'code', 'already_registered',
      'title', target_event.title,
      'confirmation_text', target_event.confirmation_text
    );
  END IF;

  SELECT count(*) INTO registrations_count
  FROM public.event_registrations
  WHERE event_id = target_event_id;

  IF target_event.capacity IS NOT NULL AND registrations_count >= target_event.capacity THEN
    RETURN jsonb_build_object('success', false, 'code', 'full', 'title', target_event.title);
  END IF;

  INSERT INTO public.event_registrations (
    event_id,
    telegram_user_id,
    telegram_chat_id,
    first_name,
    last_name,
    username
  ) VALUES (
    target_event_id,
    target_telegram_user_id,
    target_telegram_chat_id,
    NULLIF(trim(target_first_name), ''),
    NULLIF(trim(target_last_name), ''),
    NULLIF(trim(target_username), '')
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'registered',
    'title', target_event.title,
    'confirmation_text', target_event.confirmation_text,
    'registered_count', registrations_count + 1,
    'capacity', target_event.capacity
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_telegram_for_event(uuid, uuid, bigint, bigint, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_telegram_for_event(uuid, uuid, bigint, bigint, text, text, text) TO service_role;
