import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type Props = {
  token: string;
};

export function ProtocolPwaInstall({ token }: Props) {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const protocolPath = `/protocols/${token}`;
    const manifestHref = `${import.meta.env.BASE_URL}protocols-manifest.webmanifest`;
    const existingManifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const previousManifestHref = existingManifestLink?.getAttribute('href') ?? '';
    const createdManifestLink = !existingManifestLink;
    const manifestLink = existingManifestLink ?? document.createElement('link');
    const previousTitle = document.title;
    const appleTitle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    const previousAppleTitle = appleTitle?.content ?? '';

    localStorage.setItem('pwa:last-public-protocols', protocolPath);
    document.cookie = `pwa_last_public_protocols=${encodeURIComponent(protocolPath)}; Path=${import.meta.env.BASE_URL}; Max-Age=31536000; SameSite=Lax; Secure`;
    if (createdManifestLink) {
      manifestLink.rel = 'manifest';
      document.head.appendChild(manifestLink);
    }
    manifestLink.href = manifestHref;
    document.title = 'Church Protokols';
    if (appleTitle) appleTitle.content = 'Church Protokols';

    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      if (createdManifestLink) manifestLink.remove();
      else if (previousManifestHref) manifestLink.href = previousManifestHref;
      document.title = previousTitle;
      if (appleTitle) appleTitle.content = previousAppleTitle;
    };
  }, [token]);

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') setInstallPrompt(null);
  };

  if (installed || !installPrompt) return null;

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void install()} className="shrink-0">
      <Download className="mr-2 h-4 w-4" />
      Установить
    </Button>
  );
}
