-- Track bot message IDs and last activity per user for history cleanup
ALTER TABLE telegram_users
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz,
  ADD COLUMN IF NOT EXISTS bot_message_ids bigint[] DEFAULT '{}';
