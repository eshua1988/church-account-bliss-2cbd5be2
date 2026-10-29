import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });

  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth = createClient(url, anonKey);
  const { data: { user }, error: userError } = await auth.auth.getUser(token);
  if (userError || !user) return Response.json({ error: 'Требуется вход в Church Hub.' }, { status: 401, headers: corsHeaders });

  const { invitationId } = await request.json().catch(() => ({}));
  if (!invitationId) return Response.json({ error: 'Не указан идентификатор приглашения.' }, { status: 400, headers: corsHeaders });

  const admin = createClient(url, serviceKey);
  const { data: invitation, error: invitationError } = await admin
    .from('church_hub_invitations')
    .select('id,inviter_id,status')
    .eq('id', invitationId)
    .single();
  if (invitationError || !invitation || invitation.status !== 'pending') {
    return Response.json({ error: 'Приглашение недействительно или уже использовано.' }, { status: 404, headers: corsHeaders });
  }

  const { data: workspace, error: workspaceError } = await admin
    .from('hub_workspaces')
    .select('id')
    .eq('owner_id', invitation.inviter_id)
    .order('created_at')
    .limit(1)
    .single();
  if (workspaceError || !workspace) return Response.json({ error: 'Пространство Church Hub пригласившего не найдено.' }, { status: 404, headers: corsHeaders });

  // Do not copy fields from the invitation: the invited person owns and
  // completes their profile after accepting it.
  const { error: memberError } = await admin.from('hub_members').upsert({
    workspace_id: workspace.id,
    user_id: user.id,
    role: 'member',
    display_name: user.user_metadata?.display_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Участник',
    email: user.email || null,
    telegram_username: user.user_metadata?.telegram_username?.replace(/^@/, '') || null,
  }, { onConflict: 'workspace_id,user_id', ignoreDuplicates: true });
  if (memberError) return Response.json({ error: memberError.message }, { status: 500, headers: corsHeaders });

  await admin.from('church_hub_invitations').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', invitation.id);
  return Response.json({ workspaceId: workspace.id, profileRequired: true }, { headers: corsHeaders });
});
