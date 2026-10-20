import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const pdfBytes = (base64: string) => Uint8Array.from(atob(base64.replace(/^data:application\/pdf;base64,/, '')), char => char.charCodeAt(0));

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await request.json();
    const token = String(body.token || '');
    if (token.length < 10 || token.length > 100) return json({ error: 'Invalid protocol link' }, 400);
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: link } = await supabase.from('shared_transaction_links').select('owner_user_id, name, is_active').eq('token', token).maybeSingle();
    if (!link?.is_active || !String(link.name || '').startsWith('[Протоколы]')) return json({ error: 'Link is inactive or not found' }, 404);

    await supabase.from('protocol_link_settings').upsert({ link_token: token, owner_user_id: link.owner_user_id }, { onConflict: 'link_token', ignoreDuplicates: true });
    const action = String(body.action || 'load');

    if (action === 'load') {
      const [{ data: settings }, { data: documents, error }] = await Promise.all([
        supabase.from('protocol_link_settings').select('attendees, secretary_name, pastor_name, google_sheet_url, cloud_name, church_name, church_header_image, show_church_header').eq('link_token', token).single(),
        supabase.from('protocol_documents').select('*').eq('link_token', token).order('created_at', { ascending: false }),
      ]);
      if (error) throw error;
      const items = await Promise.all((documents || []).map(async (document) => {
        const { data } = await supabase.storage.from('protocol-documents').createSignedUrl(document.pdf_path, 60 * 60);
        return { ...document, pdf_url: data?.signedUrl || null };
      }));
      return json({ settings: settings || {}, documents: items });
    }

    if (action === 'save-settings') {
      const payload = body.settings || {};
      const { data, error } = await supabase.from('protocol_link_settings').update({
        attendees: Array.isArray(payload.attendees) ? payload.attendees.map((item: unknown) => String(item).trim()).filter(Boolean).slice(0, 300) : [],
        secretary_name: String(payload.secretary_name || '').slice(0, 200),
        pastor_name: String(payload.pastor_name || '').slice(0, 200),
        google_sheet_url: String(payload.google_sheet_url || '').slice(0, 1000),
        cloud_name: String(payload.cloud_name || '').slice(0, 200), church_name: String(payload.church_name || '').slice(0, 300), church_header_image: payload.church_header_image ? String(payload.church_header_image).slice(0, 3_000_000) : null, show_church_header: Boolean(payload.show_church_header), updated_at: new Date().toISOString(),
      }).eq('link_token', token).select().single();
      if (error) throw error;
      return json({ settings: data });
    }

    if (action === 'create') {
      const protocol = body.protocol || {};
      const pdf = String(protocol.pdf_base64 || '');
      if (!pdf || pdf.length > 12_000_000 || !String(protocol.content || '').trim()) return json({ error: 'Invalid protocol document' }, 400);
      const id = crypto.randomUUID();
      const filePath = `${link.owner_user_id}/${token}/${id}.pdf`;
      const { error: uploadError } = await supabase.storage.from('protocol-documents').upload(filePath, pdfBytes(pdf), { contentType: 'application/pdf', upsert: false });
      if (uploadError) throw uploadError;
      const { data, error } = await supabase.from('protocol_documents').insert({
        id, link_token: token, owner_user_id: link.owner_user_id, council: protocol.council === 'elders' ? 'elders' : 'church',
        protocol_date: protocol.protocol_date, protocol_time: protocol.protocol_time || null, place: String(protocol.place || '').slice(0, 500),
        present: Array.isArray(protocol.present) ? protocol.present : [], absent: Array.isArray(protocol.absent) ? protocol.absent : [],
        content: String(protocol.content).slice(0, 30000), secretary_name: String(protocol.secretary_name || '').slice(0, 200),
        pastor_name: String(protocol.pastor_name || '').slice(0, 200), secretary_signature: protocol.secretary_signature || null,
        pastor_signature: protocol.pastor_signature || null, pdf_path: filePath,
      }).select().single();
      if (error) { await supabase.storage.from('protocol-documents').remove([filePath]); throw error; }
      const { data: url } = await supabase.storage.from('protocol-documents').createSignedUrl(filePath, 60 * 60);
      return json({ document: { ...data, pdf_url: url?.signedUrl || null } });
    }

    if (action === 'set-archived') {
      const { data, error } = await supabase.from('protocol_documents').update({ archived: Boolean(body.archived) }).eq('id', String(body.id || '')).eq('link_token', token).select().single();
      if (error) throw error;
      const { data: url } = await supabase.storage.from('protocol-documents').createSignedUrl(data.pdf_path, 60 * 60);
      return json({ document: { ...data, pdf_url: url?.signedUrl || null } });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Server error' }, 500);
  }
});
