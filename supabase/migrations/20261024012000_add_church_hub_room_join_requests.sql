-- A room stays visible in the department directory, while its messages remain private.
DROP POLICY IF EXISTS "Hub users can read permitted rooms" ON public.church_hub_rooms;
CREATE POLICY "Hub members can view room directory" ON public.church_hub_rooms
  FOR SELECT TO authenticated USING (public.hub_is_member(workspace_id));

CREATE TABLE IF NOT EXISTS public.church_hub_room_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.church_hub_rooms(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (room_id, requester_id)
);

ALTER TABLE public.church_hub_room_join_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members request room access" ON public.church_hub_room_join_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requester_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.church_hub_rooms room
      WHERE room.id = room_id AND public.hub_is_member(room.workspace_id)
    )
  );

CREATE POLICY "Requesters view own requests" ON public.church_hub_room_join_requests
  FOR SELECT TO authenticated USING (requester_id = auth.uid());

CREATE POLICY "Room managers review requests" ON public.church_hub_room_join_requests
  FOR SELECT TO authenticated USING (public.church_hub_room_can_manage(room_id));

CREATE POLICY "Room managers update requests" ON public.church_hub_room_join_requests
  FOR UPDATE TO authenticated
  USING (public.church_hub_room_can_manage(room_id))
  WITH CHECK (public.church_hub_room_can_manage(room_id));
