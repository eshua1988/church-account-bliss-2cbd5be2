import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createR2SignedUrl, isR2Configured, r2ObjectExists, uploadToR2 } from '../_shared/r2.ts';

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

    const action = String(body.action || 'load');
    const isPublicAction = Boolean(body.public) && (action === 'load' || action === 'create');
    const isSigningAction = action === 'load-signing' || action === 'sign';
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization') || '';
    const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
    });
    const { data: { user: protocolUser } } = await authClient.auth.getUser();
    if (!isSigningAction && !isPublicAction && !protocolUser) return json({ error: 'Войдите в аккаунт протоколов' }, 401);
    let workspaceUserId = protocolUser?.id || null;
    if (isPublicAction && !workspaceUserId) {
      const { data: publicSettings } = await supabase.from('protocol_link_settings')
        .select('owner_user_id').eq('link_token', token).order('updated_at', { ascending: false }).limit(1).maybeSingle();
      workspaceUserId = publicSettings?.owner_user_id || null;
      if (!workspaceUserId) return json({ error: 'Настройки протокола ещё не подготовлены владельцем ссылки' }, 404);
    }
    if (!isSigningAction && workspaceUserId) {
      const { error: workspaceError } = await supabase.from('protocol_link_settings').upsert(
        { link_token: token, owner_user_id: workspaceUserId },
        { onConflict: 'link_token,owner_user_id', ignoreDuplicates: true },
      );
      if (workspaceError) throw workspaceError;
    }

    // A trash item can be restored for two days.  Removal is also performed
    // here so it works without requiring a database cron extension.
    const expiry = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const { data: expired } = await supabase.from('protocol_documents').select('id, pdf_path')
      .eq('link_token', token).eq('owner_user_id', workspaceUserId).lt('deleted_at', expiry);
    if (expired?.length) {
      await supabase.storage.from('protocol-documents').remove(expired.map(item => item.pdf_path));
      await supabase.from('protocol_documents').delete().in('id', expired.map(item => item.id));
    }

    if (action === 'load') {
      const [{ data: settings }, { data: documents, error }] = await Promise.all([
        supabase.from('protocol_link_settings').select('attendees, councils, secretary_name, secretary_signature, pastor_name, google_sheet_url, google_sheet_name, cloud_name, google_drive_client_id, church_name, church_header_image, show_church_header, church_header_style, church_header_text_style, church_header_font_size, church_header_font_family').eq('link_token', token).eq('owner_user_id', workspaceUserId).single(),
        supabase.from('protocol_documents').select('*').eq('link_token', token).eq('owner_user_id', workspaceUserId).is('deleted_at', null).order('created_at', { ascending: false }),
      ]);
      if (error) throw error;
      // Listing a workspace must not sign every archived PDF. Large archives
      // previously produced hundreds of Storage requests on each refresh.
      // A signed URL is created only after the user opens that particular PDF.
      return json({ settings: settings || {}, documents: documents || [] });
    }

    if (action === 'save-settings') {
      const payload = body.settings || {};
      const councils = Array.isArray(payload.councils) ? payload.councils.map((item: any, index: number) => ({
        id: String(item?.id || `council-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60),
        name: String(item?.name || '').trim().slice(0, 120),
        attendees: Array.isArray(item?.attendees) ? item.attendees.map((person: unknown) => String(person).trim()).filter(Boolean).slice(0, 300) : [],
      })).filter((item: any) => item.id && item.name).slice(0, 30) : null;
      const { data, error } = await supabase.from('protocol_link_settings').update({
        attendees: Array.isArray(payload.attendees) ? payload.attendees.map((item: unknown) => String(item).trim()).filter(Boolean).slice(0, 300) : [],
        ...(councils ? { councils } : {}),
        secretary_name: String(payload.secretary_name || '').slice(0, 200),
        secretary_signature: payload.secretary_signature ? String(payload.secretary_signature).slice(0, 3_000_000) : null,
        pastor_name: String(payload.pastor_name || '').slice(0, 200),
        google_sheet_url: String(payload.google_sheet_url || '').slice(0, 1000),
        google_sheet_name: String(payload.google_sheet_name || '').trim().slice(0, 200),
        cloud_name: String(payload.cloud_name || '').slice(0, 200), google_drive_client_id: String(payload.google_drive_client_id || '').slice(0, 300), church_name: String(payload.church_name || '').slice(0, 300), church_header_image: payload.church_header_image ? String(payload.church_header_image).slice(0, 3_000_000) : null, show_church_header: Boolean(payload.show_church_header), church_header_style: ['classic', 'warm', 'midnight'].includes(String(payload.church_header_style)) ? String(payload.church_header_style) : 'classic', church_header_text_style: ['regular', 'bold', 'italic', 'bold_italic'].includes(String(payload.church_header_text_style)) ? String(payload.church_header_text_style) : 'regular', church_header_font_size: Math.min(48, Math.max(10, Number(payload.church_header_font_size) || 20)), church_header_font_family: ['roboto', 'liberation'].includes(String(payload.church_header_font_family)) ? String(payload.church_header_font_family) : 'roboto', updated_at: new Date().toISOString(),
      }).eq('link_token', token).eq('owner_user_id', workspaceUserId).select().single();
      if (error) throw error;
      return json({ settings: data });
    }

    if (action === 'create') {
      const protocol = body.protocol || {};
      const pdf = String(protocol.pdf_base64 || '');
      if (!pdf || pdf.length > 12_000_000 || !String(protocol.content || '').trim()) return json({ error: 'Invalid protocol document' }, 400);
      const id = crypto.randomUUID();
      const filePath = `${workspaceUserId}/${token}/${id}.pdf`;
      try { if (!isR2Configured()) throw new Error('R2 is not configured'); await uploadToR2(filePath, pdfBytes(pdf), 'application/pdf'); }
      catch (r2Error) { console.warn('R2 protocol upload failed, using legacy Storage:', r2Error); const { error: uploadError } = await supabase.storage.from('protocol-documents').upload(filePath, pdfBytes(pdf), { contentType: 'application/pdf', upsert: false }); if (uploadError) throw uploadError; }
      const { data, error } = await supabase.from('protocol_documents').insert({
        id, link_token: token, owner_user_id: workspaceUserId, council: String(protocol.council || '').slice(0, 60) || 'elders',
        protocol_date: protocol.protocol_date, protocol_time: protocol.protocol_time || null, place: String(protocol.place || '').slice(0, 500),
        present: Array.isArray(protocol.present) ? protocol.present : [], absent: Array.isArray(protocol.absent) ? protocol.absent : [],
        content: String(protocol.content).slice(0, 30000), secretary_name: String(protocol.secretary_name || '').slice(0, 200),
        pastor_name: String(protocol.pastor_name || '').slice(0, 200), secretary_signature: protocol.secretary_signature || null,
        pastor_signature: null, pdf_path: filePath,
      }).select().single();
      if (error) { await supabase.storage.from('protocol-documents').remove([filePath]); throw error; }
      return json({ document: data });
    }

    if (action === 'create-excerpt') {
      const protocol = body.protocol || {};
      const pdf = String(protocol.pdf_base64 || '');
      if (!pdf || pdf.length > 12_000_000 || !String(protocol.content || '').trim()) return json({ error: 'Invalid protocol excerpt' }, 400);
      const id = crypto.randomUUID();
      const filePath = `${workspaceUserId}/${token}/${id}.pdf`;
      try { if (!isR2Configured()) throw new Error('R2 is not configured'); await uploadToR2(filePath, pdfBytes(pdf), 'application/pdf'); }
      catch (r2Error) { console.warn('R2 excerpt upload failed, using legacy Storage:', r2Error); const { error: uploadError } = await supabase.storage.from('protocol-documents').upload(filePath, pdfBytes(pdf), { contentType: 'application/pdf', upsert: false }); if (uploadError) throw uploadError; }
      const { data, error } = await supabase.from('protocol_documents').insert({
        id, link_token: token, owner_user_id: workspaceUserId, council: String(protocol.council || '').slice(0, 60) || 'elders',
        protocol_date: protocol.protocol_date, protocol_time: protocol.protocol_time || null, place: String(protocol.place || '').slice(0, 500),
        present: Array.isArray(protocol.present) ? protocol.present : [], absent: Array.isArray(protocol.absent) ? protocol.absent : [],
        content: String(protocol.content).slice(0, 30000), secretary_name: String(protocol.secretary_name || '').slice(0, 200),
        pastor_name: `Выписка из протокола|${['До следующего решения', 'Одноразовая'].includes(String(protocol.excerpt_validity)) ? protocol.excerpt_validity : 'До следующего решения'}`, secretary_signature: protocol.secretary_signature || null, pastor_signature: null, pdf_path: filePath,
      }).select().single();
      if (error) throw error;
      return json({ document: data });
    }

    if (action === 'update-excerpt') {
      const protocol = body.protocol || {}; const pdf = String(protocol.pdf_base64 || ''); const id = String(body.id || '');
      if (!id || !pdf || pdf.length > 12_000_000 || !String(protocol.content || '').trim()) return json({ error: 'Invalid protocol excerpt' }, 400);
      const { data: existing, error: findError } = await supabase.from('protocol_documents').select('pdf_path, pastor_name').eq('id', id).eq('link_token', token).eq('owner_user_id', workspaceUserId).is('deleted_at', null).maybeSingle();
      if (findError) throw findError;
      if (!existing || !String(existing.pastor_name || '').startsWith('Выписка из протокола')) return json({ error: 'Excerpt not found' }, 404);
      try { if (!isR2Configured()) throw new Error('R2 is not configured'); await uploadToR2(existing.pdf_path, pdfBytes(pdf), 'application/pdf'); }
      catch (_) { const { error: uploadError } = await supabase.storage.from('protocol-documents').upload(existing.pdf_path, pdfBytes(pdf), { contentType: 'application/pdf', upsert: true }); if (uploadError) throw uploadError; }
      const { data, error } = await supabase.from('protocol_documents').update({
        content: String(protocol.content).slice(0, 30000), secretary_name: String(protocol.secretary_name || '').slice(0, 200), secretary_signature: protocol.secretary_signature || null,
        pastor_name: `Выписка из протокола|${['До следующего решения', 'Одноразовая'].includes(String(protocol.excerpt_validity)) ? protocol.excerpt_validity : 'До следующего решения'}`,
      }).eq('id', id).eq('link_token', token).eq('owner_user_id', workspaceUserId).select().single();
      if (error) throw error;
      return json({ document: data });
    }

    if (action === 'update') {
      const protocol = body.protocol || {}; const pdf = String(protocol.pdf_base64 || ''); const id = String(body.id || '');
      if (!id || !pdf || pdf.length > 12_000_000 || !String(protocol.content || '').trim()) return json({ error: 'Invalid protocol document' }, 400);
      const { data: existing, error: findError } = await supabase.from('protocol_documents').select('pdf_path, pastor_signed_at').eq('id', id).eq('link_token', token).eq('owner_user_id', workspaceUserId).is('deleted_at', null).maybeSingle();
      if (findError) throw findError;
      if (!existing) return json({ error: 'Protocol not found' }, 404);
      if (existing.pastor_signed_at) return json({ error: 'Signed protocols cannot be edited' }, 409);
      try { if (!isR2Configured()) throw new Error('R2 is not configured'); await uploadToR2(existing.pdf_path, pdfBytes(pdf), 'application/pdf'); }
      catch (_) { const { error: uploadError } = await supabase.storage.from('protocol-documents').upload(existing.pdf_path, pdfBytes(pdf), { contentType: 'application/pdf', upsert: true }); if (uploadError) throw uploadError; }
      const { data, error } = await supabase.from('protocol_documents').update({ council: String(protocol.council || '').slice(0, 60) || 'elders', protocol_date: protocol.protocol_date, protocol_time: protocol.protocol_time || null, place: String(protocol.place || '').slice(0, 500), present: Array.isArray(protocol.present) ? protocol.present : [], absent: Array.isArray(protocol.absent) ? protocol.absent : [], content: String(protocol.content).slice(0, 30000), secretary_name: String(protocol.secretary_name || '').slice(0, 200), pastor_name: String(protocol.pastor_name || '').slice(0, 200), secretary_signature: protocol.secretary_signature || null }).eq('id', id).eq('link_token', token).eq('owner_user_id', workspaceUserId).is('pastor_signed_at', null).select().maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'Signed protocols cannot be edited' }, 409);
      return json({ document: data });
    }
    if (action === 'set-archived') {
      const { data, error } = await supabase.from('protocol_documents').update({ archived: Boolean(body.archived) }).eq('id', String(body.id || '')).eq('link_token', token).eq('owner_user_id', workspaceUserId).select().single();
      if (error) throw error;
      return json({ document: data });
    }

    // Signed storage URLs are intentionally short-lived.  ZIP exports ask for
    // a fresh URL so an archive can still be built from older open pages.
    if (action === 'get-pdf-url') {
      const { data, error } = await supabase.from('protocol_documents').select('id, pdf_path')
        .eq('id', String(body.id || '')).eq('link_token', token).eq('owner_user_id', workspaceUserId).is('deleted_at', null).maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'Protocol not found' }, 404);
      try {
        if (!isR2Configured() || !(await r2ObjectExists(data.pdf_path))) throw new Error('R2 object is not available');
        return json({ pdf_url: await createR2SignedUrl(data.pdf_path, 'GET', { expiresInSeconds: 3600 }) });
      }
      catch (_) { const { data: url, error: urlError } = await supabase.storage.from('protocol-documents').createSignedUrl(data.pdf_path, 60 * 60); if (urlError || !url?.signedUrl) throw urlError || new Error('Could not create PDF URL'); return json({ pdf_url: url.signedUrl }); }
    }

    if (action === 'load-trash') {
      const { data: documents, error } = await supabase.from('protocol_documents').select('*')
        .eq('link_token', token).eq('owner_user_id', workspaceUserId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false });
      if (error) throw error;
      return json({ documents: documents || [] });
    }

    if (action === 'move-to-trash') {
      const { data, error } = await supabase.from('protocol_documents').update({ deleted_at: new Date().toISOString() })
        .eq('id', String(body.id || '')).eq('link_token', token).eq('owner_user_id', workspaceUserId).is('deleted_at', null).select().maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'Protocol not found' }, 404);
      return json({ document: data });
    }

    if (action === 'restore-from-trash') {
      const { data, error } = await supabase.from('protocol_documents').update({ deleted_at: null })
        .eq('id', String(body.id || '')).eq('link_token', token).eq('owner_user_id', workspaceUserId).not('deleted_at', 'is', null).select().maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'Protocol not found or already permanently deleted' }, 404);
      return json({ document: data });
    }

    // Signing is intentionally available without the protocol-workspace link.
    // A random per-document token is the capability and is cleared after use.
    if (action === 'load-signing') {
      const signToken = String(body.sign_token || '');
      const { data, error } = await supabase.from('protocol_documents')
        .select('id, pastor_name, pastor_signed_at, pdf_path, protocol_date, council')
        .eq('pastor_sign_token', signToken).is('deleted_at', null).maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'Signing link not found' }, 404);
      try {
        if (!isR2Configured() || !(await r2ObjectExists(data.pdf_path))) throw new Error('R2 object is not available');
        return json({ document: { ...data, pdf_url: await createR2SignedUrl(data.pdf_path, 'GET', { expiresInSeconds: 3600 }) } });
      }
      catch (_) {
        const { data: url, error: urlError } = await supabase.storage.from('protocol-documents').createSignedUrl(data.pdf_path, 60 * 60);
        if (urlError || !url?.signedUrl) throw urlError || new Error('Could not create PDF URL');
        return json({ document: { ...data, pdf_url: url.signedUrl } });
      }
    }

    if (action === 'sign') {
      const signToken = String(body.sign_token || '');
      const pdf = String(body.pdf_base64 || '');
      const signature = String(body.pastor_signature || '');
      if (!pdf || pdf.length > 12_000_000 || !signature.startsWith('data:image/')) return json({ error: 'Invalid signature' }, 400);
      const { data: document, error: findError } = await supabase.from('protocol_documents')
        .select('id, pdf_path, pastor_signed_at').eq('pastor_sign_token', signToken).is('deleted_at', null).maybeSingle();
      if (findError) throw findError;
      if (!document) return json({ error: 'Signing link not found' }, 404);
      if (document.pastor_signed_at) return json({ error: 'This protocol has already been signed' }, 409);
      try { if (!isR2Configured()) throw new Error('R2 is not configured'); await uploadToR2(document.pdf_path, pdfBytes(pdf), 'application/pdf'); }
      catch (_) { const { error: uploadError } = await supabase.storage.from('protocol-documents').upload(document.pdf_path, pdfBytes(pdf), { contentType: 'application/pdf', upsert: true }); if (uploadError) throw uploadError; }
      const { data, error } = await supabase.from('protocol_documents').update({
        pastor_signature: signature.slice(0, 3_000_000), pastor_signed_at: new Date().toISOString(), pastor_sign_token: crypto.randomUUID(),
      }).eq('id', document.id).eq('pastor_sign_token', signToken).is('pastor_signed_at', null).select().maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: 'This protocol has already been signed' }, 409);
      return json({ document: data });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Server error' }, 500);
  }
});
