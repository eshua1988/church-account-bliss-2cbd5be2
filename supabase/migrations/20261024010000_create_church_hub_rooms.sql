CREATE TABLE IF NOT EXISTS public.church_hub_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  department text,
  room_type text NOT NULL CHECK (room_type IN ('church', 'department')),
  access_mode text NOT NULL DEFAULT 'members' CHECK (access_mode IN ('all', 'members', 'leaders')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);

CREATE TABLE IF NOT EXISTS public.church_hub_room_members (
  room_id uuid NOT NULL REFERENCES public.church_hub_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'leader', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.church_hub_room_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES public.church_hub_rooms(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.church_hub_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_hub_room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_hub_room_messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_church_hub_room_member(target_room uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.church_hub_room_members WHERE room_id = target_room AND user_id = auth.uid());
$$;

CREATE POLICY "Room members can read rooms" ON public.church_hub_rooms FOR SELECT
  USING (room_type = 'church' OR public.is_church_hub_room_member(id) OR owner_id = auth.uid());
CREATE POLICY "Owners create rooms" ON public.church_hub_rooms FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owners manage rooms" ON public.church_hub_rooms FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "Members can read room membership" ON public.church_hub_room_members FOR SELECT
  USING (public.is_church_hub_room_member(room_id) OR user_id = auth.uid());
CREATE POLICY "Room leaders manage membership" ON public.church_hub_room_members FOR ALL
  USING (EXISTS (SELECT 1 FROM public.church_hub_room_members m WHERE m.room_id = room_id AND m.user_id = auth.uid() AND m.role IN ('owner','leader')));

CREATE POLICY "Members read room messages" ON public.church_hub_room_messages FOR SELECT
  USING (public.is_church_hub_room_member(room_id));
CREATE POLICY "Members write room messages" ON public.church_hub_room_messages FOR INSERT
  WITH CHECK (author_id = auth.uid() AND public.is_church_hub_room_member(room_id));
