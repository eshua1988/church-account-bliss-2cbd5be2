import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type PushRequest = {
  notification_id?: string;
  user_id?: string;
  title?: string;
  message?: string;
  url?: string;
};

const getAuthUserId = async (req: Request, supabaseUrl: string, anonKey: string) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data } = await userClient.auth.getUser();
  return data.user?.id || null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY') || '';
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') || '';
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';

    if (!vapidPublicKey || !vapidPrivateKey) {
      console.warn('VAPID keys are missing; push notification skipped');
      return new Response(JSON.stringify({ sent: 0, skipped: 'missing_vapid_keys' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json() as PushRequest;
    const supabase = createClient(supabaseUrl, serviceKey);

    let target = {
      id: body.notification_id || crypto.randomUUID(),
      user_id: body.user_id || '',
      title: body.title || 'Новое уведомление',
      message: body.message || '',
    };

    if (body.notification_id) {
      const { data: notification, error } = await supabase
        .from('notifications')
        .select('id, user_id, title, message')
        .eq('id', body.notification_id)
        .single();

      if (error || !notification) {
        return new Response(JSON.stringify({ error: 'Notification not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const authHeader = req.headers.get('Authorization') || '';
      const calledWithServiceRole = authHeader === `Bearer ${serviceKey}`;
      if (!calledWithServiceRole && anonKey) {
        const authUserId = await getAuthUserId(req, supabaseUrl, anonKey);
        if (authUserId !== notification.user_id) {
          return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      target = notification;
    }

    if (!target.user_id) {
      return new Response(JSON.stringify({ error: 'Missing user_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: subscriptionRows, error: subError } = await supabase
      .from('notifications')
      .select('id, metadata')
      .eq('user_id', target.user_id)
      .eq('type', 'push_subscription');

    if (subError) throw subError;
    const subscriptions = Array.from(
      new Map((subscriptionRows || [])
        .map((row: any) => ({
          id: row.id,
          endpoint: row.metadata?.endpoint,
          p256dh: row.metadata?.p256dh,
          auth: row.metadata?.auth,
        }))
        .filter((row: any) => row.endpoint && row.p256dh && row.auth)
        .map((row: any) => [row.endpoint, row]))
        .values(),
    );

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const payload = JSON.stringify({
      title: target.title || 'Новое уведомление',
      body: target.message || '',
      notification_id: target.id,
      tag: target.id,
      url: body.url || '/church-account-bliss-2cbd5be2/',
    });

    let sent = 0;
    const expiredIds: string[] = [];

    await Promise.all(subscriptions.map(async (subscription: any) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        }, payload);
        sent += 1;
      } catch (error: any) {
        const statusCode = error?.statusCode || error?.status;
        console.error('Push send failed:', statusCode, error?.message || error);
        if (statusCode === 404 || statusCode === 410) {
          expiredIds.push(subscription.id);
        }
      }
    }));

    if (expiredIds.length > 0) {
      await supabase.from('notifications').delete().in('id', expiredIds);
    }

    return new Response(JSON.stringify({ sent, removed: expiredIds.length }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Unexpected push error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
