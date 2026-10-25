-- Rich Church Hub rooms: common church room, feed types and private uploads.
ALTER TABLE public.church_hub_room_messages
  ADD COLUMN IF NOT EXISTS message_type text NOT NULL DEFAULT 'chat'
    CHECK (message_type IN ('chat', 'announcement', 'reminder')),
  ADD COLUMN IF NOT EXISTS attachment jsonb,
  ADD COLUMN IF NOT EXISTS remind_at timestamptz;

CREATE INDEX IF NOT EXISTS church_hub_room_messages_feed_index
  ON public.church_hub_room_messages (room_id, message_type, created_at DESC);

CREATE OR REPLACE FUNCTION public.hub_ensure_church_room()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_workspace_id uuid;
  existing_room_id uuid;
BEGIN
  SELECT workspace_id INTO current_workspace_id
  FROM public.hub_members
  WHERE user_id = auth.uid()
  ORDER BY created_at
  LIMIT 1;

  IF current_workspace_id IS NULL OR NOT public.hub_is_leader(current_workspace_id) THEN
    RAISE EXCEPTION 'Church Hub administrator or leader access is required';
  END IF;

  SELECT id INTO existing_room_id
  FROM public.church_hub_rooms
  WHERE workspace_id = current_workspace_id AND room_type = 'church'
  LIMIT 1;

  IF existing_room_id IS NULL THEN
    INSERT INTO public.church_hub_rooms (workspace_id, owner_id, name, room_type, access_mode)
    VALUES (current_workspace_id, auth.uid(), 'Церковь', 'church', 'all')
    RETURNING id INTO existing_room_id;
  END IF;

  RETURN existing_room_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hub_ensure_church_room() TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('church-hub-room-files', 'church-hub-room-files', false, 26214400)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 26214400;

DROP POLICY IF EXISTS "Room participants read private files" ON storage.objects;
DROP POLICY IF EXISTS "Room participants read private files" ON storage.objects;
CREATE POLICY "Room participants read private files" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'church-hub-room-files'
    AND public.church_hub_room_can_access((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "Room participants upload private files" ON storage.objects;
DROP POLICY IF EXISTS "Room participants upload private files" ON storage.objects;
CREATE POLICY "Room participants upload private files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'church-hub-room-files'
    AND public.church_hub_room_can_access((storage.foldername(name))[1]::uuid)
    AND owner_id = auth.uid()::text
  );

DROP POLICY IF EXISTS "Authors remove own private files" ON storage.objects;
DROP POLICY IF EXISTS "Authors remove own private files" ON storage.objects;
CREATE POLICY "Authors remove own private files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'church-hub-room-files' AND owner_id = auth.uid()::text);