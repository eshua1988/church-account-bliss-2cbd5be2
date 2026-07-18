import { useEffect, useRef, useState } from 'react';
import { CircleHelp, Cloud, Link2, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CLOUD_PROVIDER_LABELS,
  CloudConnection,
  CloudProvider,
  loadCloudConnections,
  saveCloudConnections,
} from '@/lib/cloudStorage';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';

const HELP_CONTENT: Record<CloudProvider, { title: string; steps: string[] }> = {
  google_drive: {
    title: 'Подключение Google Drive',
    steps: [
      'Создайте папку на Google Drive и вставьте сюда ссылку на неё.',
      'В Google Cloud включите Google Drive API.',
      'Создайте OAuth 2.0 Client ID типа «Веб-приложение».',
      'В разрешённые источники JavaScript добавьте https://eshua1988.github.io.',
      'Если приложение тестируется, добавьте свой email в «Получатели → Тестовые пользователи».',
      'Вставьте Client ID и нажмите «Подключить Google Drive». Пароль Google вводить не нужно.',
    ],
  },
  onedrive: {
    title: 'Подключение OneDrive',
    steps: [
      'Создайте папку OneDrive и вставьте общую ссылку на неё.',
      'В Microsoft Entra зарегистрируйте приложение и разрешите Microsoft Graph Files.ReadWrite.',
      'Получите OAuth access token и вставьте его в поле подключения.',
      'Сохраните подключение. При ошибке 401 получите новый токен.',
    ],
  },
  dropbox: {
    title: 'Подключение Dropbox',
    steps: [
      'Создайте приложение в Dropbox App Console.',
      'Разрешите files.content.write и files.metadata.read.',
      'Создайте access token и укажите путь к папке, например /Church Accounting.',
      'Сохраните подключение. Архивы с одинаковым именем будут обновляться.',
    ],
  },
  webdav: {
    title: 'Подключение WebDAV / Nextcloud',
    steps: [
      'Укажите полный WebDAV URL вашего облака.',
      'Укажите путь к папке для ZIP-архивов.',
      'Введите логин и пароль приложения, а не основной пароль аккаунта.',
      'На сервере WebDAV должен быть разрешён CORS для домена приложения.',
    ],
  },
};

const withoutSecrets = (connection: CloudConnection): CloudConnection => {
  const { accessToken: _accessToken, password: _password, ...safe } = connection;
  return safe;
};

const createConnection = (provider: CloudProvider): CloudConnection => ({
  id: crypto.randomUUID(),
  provider,
  name: CLOUD_PROVIDER_LABELS[provider],
  enabled: true,
  folderPath: 'Church Accounting',
});

export const CloudStorageSettings = () => {
  const [connections, setConnections] = useState<CloudConnection[]>(loadCloudConnections);
  const [newProvider, setNewProvider] = useState<CloudProvider>('google_drive');
  const [helpProvider, setHelpProvider] = useState<CloudProvider | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const loadedRemoteFor = useRef<string | null>(null);

  useEffect(() => {
    if (!user || loadedRemoteFor.current === user.id) return;
    loadedRemoteFor.current = user.id;
    const remote = Array.isArray(user.user_metadata?.cloud_connections)
      ? user.user_metadata.cloud_connections as CloudConnection[]
      : [];
    if (remote.length === 0) return;

    setConnections(current => {
      const localById = new Map(current.map(connection => [connection.id, connection]));
      const merged = remote.map(connection => ({
        ...connection,
        accessToken: localById.get(connection.id)?.accessToken,
        password: localById.get(connection.id)?.password,
      }));
      for (const local of current) {
        if (!merged.some(connection => connection.id === local.id)) merged.push(local);
      }
      saveCloudConnections(merged);
      return merged;
    });
  }, [user]);

  const update = (id: string, patch: Partial<CloudConnection>) =>
    setConnections(prev => prev.map(connection => connection.id === id ? { ...connection, ...patch } : connection));

  const loadGoogleIdentity = () => new Promise<void>((resolve, reject) => {
    if ((window as any).google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Не удалось загрузить Google OAuth')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Не удалось загрузить Google OAuth'));
    document.head.appendChild(script);
  });

  const connectGoogleDrive = async (connection: CloudConnection) => {
    if (!connection.clientId?.trim()) {
      toast({ title: 'Укажите Google OAuth Client ID', variant: 'destructive' });
      return;
    }
    try {
      await loadGoogleIdentity();
      const client = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: connection.clientId.trim(),
        scope: 'https://www.googleapis.com/auth/drive',
        callback: (response: { access_token?: string; error?: string; error_description?: string }) => {
          if (!response.access_token) {
            toast({
              title: 'Google Drive не подключён',
              description: response.error_description || response.error || 'Авторизация отменена',
              variant: 'destructive',
            });
            return;
          }
          const next = connections.map(item =>
            item.id === connection.id ? { ...item, accessToken: response.access_token } : item,
          );
          setConnections(next);
          void persist(next, 'Google Drive подключён');
        },
      });
      client.requestAccessToken({ prompt: '' });
    } catch (error) {
      toast({
        title: 'Ошибка Google OAuth',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    }
  };

  const persist = async (nextConnections = connections, message = 'Настройки облака сохранены') => {
    saveCloudConnections(nextConnections);
    if (user) {
      const { error } = await supabase.auth.updateUser({
        data: { cloud_connections: nextConnections.map(withoutSecrets) },
      });
      if (error) {
        toast({ title: 'Не удалось сохранить настройки в профиле', description: error.message, variant: 'destructive' });
        return;
      }
    }
    toast({ title: message });
  };

  const remove = (id: string) => {
    const next = connections.filter(item => item.id !== id);
    setConnections(next);
    void persist(next, 'Облако удалено');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={newProvider} onValueChange={(value) => setNewProvider(value as CloudProvider)}>
          <SelectTrigger className="sm:max-w-xs">
            <SelectValue placeholder="Выберите облако" />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(CLOUD_PROVIDER_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" className="gap-2" onClick={() => setConnections(prev => [...prev, createConnection(newProvider)])}>
          <Plus className="h-4 w-4" />
          Добавить облако
        </Button>
      </div>

      {connections.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground">
          <Cloud className="mx-auto mb-2 h-8 w-8 opacity-50" />
          Облачные хранилища ещё не добавлены
        </div>
      )}

      {connections.map(connection => (
        <div key={connection.id} className="space-y-3 rounded-xl border border-border p-4">
          <div className="flex items-center gap-3">
            <Cloud className="h-5 w-5 text-primary" />
            <Input
              value={connection.name}
              onChange={(event) => update(connection.id, { name: event.target.value })}
              placeholder="Название подключения"
            />
            <Switch checked={connection.enabled} onCheckedChange={(enabled) => update(connection.id, { enabled })} />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setHelpProvider(connection.provider)}
              aria-label={`Инструкция: ${CLOUD_PROVIDER_LABELS[connection.provider]}`}
              title="Инструкция по подключению"
            >
              <CircleHelp className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => void persist()}
              aria-label="Сохранить облако"
              title="Сохранить"
            >
              <Save className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={() => remove(connection.id)}
              aria-label="Удалить облако"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          {connection.provider === 'google_drive' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input className="sm:col-span-2" value={connection.folderUrl || ''} onChange={(e) => update(connection.id, { folderUrl: e.target.value })} placeholder="Ссылка на папку Google Drive" />
              <Input className="sm:col-span-2" value={connection.clientId || ''} onChange={(e) => update(connection.id, { clientId: e.target.value })} placeholder="Google OAuth Client ID (*.apps.googleusercontent.com)" />
              <Button type="button" variant="outline" className="gap-2 sm:col-span-2" onClick={() => connectGoogleDrive(connection)}>
                <Link2 className="h-4 w-4" />
                {connection.accessToken ? 'Переподключить Google Drive' : 'Подключить Google Drive'}
              </Button>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                {connection.accessToken
                  ? 'Авторизация получена. Если появится ошибка 401, подключите Google Drive повторно.'
                  : 'На этом устройстве Google Drive ещё не подключён. Пароль вводить не нужно — вход откроется в официальном окне Google.'}
              </p>
            </div>
          )}
          {connection.provider === 'onedrive' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input className="sm:col-span-2" value={connection.folderUrl || ''} onChange={(e) => update(connection.id, { folderUrl: e.target.value })} placeholder="Ссылка на папку OneDrive" />
              <Input type="password" value={connection.accessToken || ''} onChange={(e) => update(connection.id, { accessToken: e.target.value })} placeholder="OAuth access token" />
              <Input value={connection.folderPath || ''} onChange={(e) => update(connection.id, { folderPath: e.target.value })} placeholder="Путь к папке, если ссылка не указана" />
            </div>
          )}
          {connection.provider === 'dropbox' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input type="password" value={connection.accessToken || ''} onChange={(e) => update(connection.id, { accessToken: e.target.value })} placeholder="OAuth access token" />
              <Input value={connection.folderPath || ''} onChange={(e) => update(connection.id, { folderPath: e.target.value })} placeholder="Путь к папке" />
            </div>
          )}
          {connection.provider === 'webdav' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input value={connection.baseUrl || ''} onChange={(e) => update(connection.id, { baseUrl: e.target.value })} placeholder="https://cloud.example.com/remote.php/dav/files/user" />
              <Input value={connection.folderPath || ''} onChange={(e) => update(connection.id, { folderPath: e.target.value })} placeholder="Путь к папке" />
              <Input value={connection.username || ''} onChange={(e) => update(connection.id, { username: e.target.value })} placeholder="Логин" />
              <Input type="password" value={connection.password || ''} onChange={(e) => update(connection.id, { password: e.target.value })} placeholder="Пароль приложения" />
            </div>
          )}
        </div>
      ))}

      <p className="text-xs text-muted-foreground">
        Названия, ссылки и Client ID синхронизируются между устройствами. OAuth-токены и пароли хранятся только на устройстве, где выполнено подключение.
      </p>

      <Dialog open={helpProvider !== null} onOpenChange={(open) => !open && setHelpProvider(null)}>
        <DialogContent className="max-w-lg">
          {helpProvider && (
            <>
              <DialogHeader>
                <DialogTitle>{HELP_CONTENT[helpProvider].title}</DialogTitle>
              </DialogHeader>
              <ol className="space-y-3 text-sm">
                {HELP_CONTENT[helpProvider].steps.map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                      {index + 1}
                    </span>
                    <span className="pt-0.5 text-muted-foreground">{step}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
