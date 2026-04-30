# 🔗 Инструкция по инициализации таблицы shared_transaction_links

Если при попытке создать ссылку на таблицу транзакций вы видите ошибку:
```
"Could not find the table 'public.shared_transaction_links' in the schema cache"
```

Или ссылка не открывается с ошибкой "Invalid or expired link", выполните эти шаги:

## 1. Откройте Supabase SQL Editor

Перейдите в [Supabase Dashboard](https://supabase.com/dashboard) → выберите проект → SQL Editor

## 2. Создайте новый запрос

Нажмите "+ New Query"

## 3. Скопируйте и выполните SQL код

Откройте файл `supabase/setup_shared_transaction_links.sql` и скопируйте весь его содержимое.

Вставьте в SQL Editor и нажмите "Run"

## 4. Или выполните этот SQL напрямую:

```sql
DROP TABLE IF EXISTS public.shared_transaction_links CASCADE;

CREATE TABLE public.shared_transaction_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_shared_transaction_links_token ON public.shared_transaction_links(token);
CREATE INDEX idx_shared_transaction_links_owner ON public.shared_transaction_links(owner_user_id);

ALTER TABLE public.shared_transaction_links ENABLE ROW LEVEL SECURITY;

-- Policies for authenticated users
CREATE POLICY "Users can view their own shared transaction links"
ON public.shared_transaction_links FOR SELECT USING (auth.uid() = owner_user_id);

CREATE POLICY "Users can create shared transaction links"
ON public.shared_transaction_links FOR INSERT WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "Users can update their own shared transaction links"
ON public.shared_transaction_links FOR UPDATE USING (auth.uid() = owner_user_id);

CREATE POLICY "Users can delete their own shared transaction links"
ON public.shared_transaction_links FOR DELETE USING (auth.uid() = owner_user_id);

-- ⚠️ IMPORTANT: Policy for anonymous users (public access)
CREATE POLICY "Anonymous users can view active links by token"
ON public.shared_transaction_links FOR SELECT USING (is_active = true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_transaction_links TO authenticated;
GRANT SELECT ON public.shared_transaction_links TO anon;
```

## 5. Готово!

После выполнения SQL скрипта:
- Таблица будет создана ✓
- RLS политики будут установлены ✓
- Разрешения будут выданы ✓
- **Анонимные пользователи смогут читать активные ссылки** ✓

Теперь ссылки на таблицу транзакций будут работать!

---

### 📌 Важно:
- Политика `"Anonymous users can view active links by token"` **ОБЯЗАТЕЛЬНА** для работы публичных ссылок
- Убедитесь, что ссылка имеет статус **"Активна"** в приложении
- Только активные ссылки (`is_active = true`) доступны анонимным пользователям

