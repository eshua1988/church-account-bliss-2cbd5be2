import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import fontkit from '@pdf-lib/fontkit';
import { Archive, Bell, Check, CircleUserRound, CloudUpload, Download, FileDown, FileText, Loader2, LogIn, LogOut, Menu, Plus, RefreshCw, RotateCcw, Settings, Table2, Trash2, Users, X } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { User } from '@supabase/supabase-js';
import { protocolAuth } from '@/lib/protocolAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ROBOTO_FONT_BASE64 } from '@/lib/robotoFont';
import { CloudConnection, hasCloudCredentials, isCloudEnabledOnDevice, loadCloudConnections, renewGoogleDriveToken, saveCloudConnections, uploadCloudArchive } from '@/lib/cloudStorage';
import { ProtocolPwaInstall } from '@/components/ProtocolPwaInstall';
const today = () => new Date().toISOString().slice(0, 10);
const defaultCouncils = [{ id: 'elders', name: 'Пресвитерский совет', attendees: [] as string[] }, { id: 'church', name: 'Церковный совет', attendees: [] as string[] }];
const monthFolders = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
type Council = string;
type CouncilSetting = {
    id: string;
    name: string;
    attendees: string[];
};
type Section = 'create' | 'settings' | 'notifications' | 'trash' | 'account';
type Protocol = {
    id: string;
    council: Council;
    protocol_date: string;
    protocol_time: string;
    place: string;
    present: string[];
    absent: string[];
    content: string;
    secretary_name: string;
    pastor_name: string;
    pastor_sign_token?: string;
    pastor_signed_at?: string | null;
    pdf_url?: string;
    archived: boolean;
    created_at: string;
    deleted_at?: string | null;
};
type ProtocolSettings = {
    attendees: string[];
    councils: CouncilSetting[];
    secretary_name: string;
    secretary_signature: string;
    pastor_name: string;
    google_sheet_url: string;
    google_sheet_name: string;
    google_sheet_range: string;
    cloud_name: string;
    church_name: string;
    church_header_image: string;
    show_church_header: boolean;
};
const emptySettings: ProtocolSettings = { attendees: [], councils: defaultCouncils, secretary_name: '', secretary_signature: '', pastor_name: '', google_sheet_url: '', google_sheet_name: '', google_sheet_range: '', cloud_name: '', church_name: '', church_header_image: '', show_church_header: false };
const bytesToBase64 = (bytes: Uint8Array) => { let output = ''; for (let i = 0; i < bytes.length; i += 0x8000)
    output += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(output); };
const download = (blob: Blob, name: string) => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
const dateText = (date: string, time?: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00`)) + ` г.${time ? ` ${time}` : ''}`;
const hardReload = async () => {
    if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)));
    }
    window.location.reload();
};
export default function PublicProtocols() {
    const { token = '' } = useParams(); const isPublicSubmission = new URLSearchParams(window.location.search).get('public') === '1';
    const protocolBasePath = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL.slice(0, -1) : import.meta.env.BASE_URL;
    const publicProtocolUrl = `${window.location.origin}${protocolBasePath}/#/protocols/${encodeURIComponent(token)}?public=1`;
    const [protocolUser, setProtocolUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [googleLoginLoading, setGoogleLoginLoading] = useState(false);
    const [valid, setValid] = useState<boolean | null>(null);
    const [section, setSection] = useState<Section>('create');
    const [tab, setTab] = useState<'main' | 'archive'>('main');
    const [saving, setSaving] = useState(false);
    const [publicSubmissionComplete, setPublicSubmissionComplete] = useState(false);
    const settingsLoaded = useRef(false);
    const secretarySignatureCanvas = useRef<HTMLCanvasElement>(null);
    const drawingSecretarySignature = useRef(false);
    const contentEditor = useRef<HTMLTextAreaElement>(null);
    const [secretarySignatureOpen, setSecretarySignatureOpen] = useState(false);
    const [signatureDraft, setSignatureDraft] = useState('');
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
    const [settings, setSettings] = useState<ProtocolSettings>(emptySettings);
    const [googleDriveStatusVersion, setGoogleDriveStatusVersion] = useState(0);
    const [protocols, setProtocols] = useState<Protocol[]>([]);
    const [trash, setTrash] = useState<Protocol[]>([]);
    const [council, setCouncil] = useState<Council>('elders');
    const [date, setDate] = useState(today());
    const [time, setTime] = useState('');
    const [place, setPlace] = useState('');
    const [present, setPresent] = useState<string[]>([]);
    const [absent, setAbsent] = useState<string[]>([]);
    const [content, setContent] = useState('');
    const [picker, setPicker] = useState<'present' | 'absent' | null>(null);
    const [showOtherCouncilPeople, setShowOtherCouncilPeople] = useState(false);
    const [newPerson, setNewPerson] = useState('');
    const [newCouncil, setNewCouncil] = useState('');
    const [openYears, setOpenYears] = useState<string[]>([]);
    useEffect(() => { const { data: { subscription } } = protocolAuth.auth.onAuthStateChange((_event, session) => { setProtocolUser(session?.user ?? null); setAuthLoading(false); }); void protocolAuth.auth.getSession().then(({ data }) => { setProtocolUser(data.session?.user ?? null); setAuthLoading(false); }); return () => subscription.unsubscribe(); }, []);
    const invoke = useCallback(async (action: string, extra = {}) => { const { data, error } = await protocolAuth.functions.invoke('public-protocols', { body: { token, action, public: isPublicSubmission, ...extra } }); if (error || data?.error)
        throw new Error(data?.error || error.message); return data; }, [token]);
    const reload = useCallback(async () => { if (!protocolUser && !isPublicSubmission) {
        settingsLoaded.current = false;
        setSettings(emptySettings);
        setProtocols([]);
        setTrash([]);
        setValid(true);
        return;
    } try {
        const data = await invoke('load');
        setSettings({ ...emptySettings, ...(data.settings || {}) });
        setProtocols(data.documents || []);
        settingsLoaded.current = true;
        setValid(true);
    }
    catch {
        setValid(false);
    } }, [invoke, protocolUser, isPublicSubmission]);
    useEffect(() => { void reload(); }, [reload]);
    useEffect(() => { if (!settingsLoaded.current || !token || !protocolUser)
        return; const timer = window.setTimeout(() => { void invoke('save-settings', { settings }); }, 600); return () => window.clearTimeout(timer); }, [settings, token, protocolUser, invoke]);
    useEffect(() => { if (!authLoading && !protocolUser && !isPublicSubmission)
        setSection('account'); }, [authLoading, protocolUser]);
    useEffect(() => {
        const handleRefreshShortcut = (event: KeyboardEvent) => {
            if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'r') {
                event.preventDefault();
                void hardReload();
            }
        };
        window.addEventListener('keydown', handleRefreshShortcut);
        return () => window.removeEventListener('keydown', handleRefreshShortcut);
    }, []);
    const active = useMemo(() => protocols.filter(item => !item.archived), [protocols]);
    const archived = useMemo(() => protocols.filter(item => item.archived), [protocols]);
    const archiveYears = useMemo(() => archived.reduce<Record<string, Protocol[]>>((groups, item) => { const year = item.protocol_date.slice(0, 4) || 'Без года'; (groups[year] ||= []).push(item); return groups; }, {}), [archived]);
    const selectedCouncil = settings.councils.find(item => item.id === council) || settings.councils[0];
    const visibleParticipantCouncils = showOtherCouncilPeople ? settings.councils : (selectedCouncil ? [selectedCouncil] : []);
    const councilName = (id: string, grammatical = false) => { const name = settings.councils.find(item => item.id === id)?.name || id; return grammatical ? name.toLowerCase() : name; };
    const toggle = (person: string, type: 'present' | 'absent') => (type === 'present' ? setPresent : setAbsent)(current => current.includes(person) ? current.filter(item => item !== person) : [...current, person]);
    const insertTextFormat = (prefix: string) => { const editor = contentEditor.current; if (!editor) {
        setContent(value => value ? `${value}\n${prefix}` : prefix);
        return;
    } const start = editor.selectionStart; const end = editor.selectionEnd; const selected = content.slice(start, end); const inserted = selected ? selected.split('\n').map(line => line ? `${prefix}${line}` : line).join('\n') : prefix; setContent(`${content.slice(0, start)}${inserted}${content.slice(end)}`); window.requestAnimationFrame(() => { editor.focus(); const position = start + inserted.length; editor.setSelectionRange(position, position); }); };
    const addPerson = () => { const people = newPerson.split(',').map(value => value.trim()).filter(Boolean); if (!people.length || !selectedCouncil)
        return; setSettings(value => ({ ...value, councils: value.councils.map(item => item.id === selectedCouncil.id ? { ...item, attendees: [...item.attendees, ...people.filter(person => !item.attendees.includes(person))] } : item) })); setNewPerson(''); };
    const addCouncil = () => { const name = newCouncil.trim(); if (!name)
        return; const id = `council-${crypto.randomUUID().slice(0, 8)}`; setSettings(value => ({ ...value, councils: [...value.councils, { id, name, attendees: [] }] })); setCouncil(id); setNewCouncil(''); };
    const removeCouncil = (id: string) => { if (settings.councils.length <= 1)
        return; setSettings(value => ({ ...value, councils: value.councils.filter(item => item.id !== id) })); if (council === id)
        setCouncil(settings.councils.find(item => item.id !== id)?.id || ''); };
    const saveSettings = async () => { setSaving(true); try {
        await invoke('save-settings', { settings });
        await reload();
    }
    finally {
        setSaving(false);
    } };
    const signaturePoint = (event: React.PointerEvent<HTMLCanvasElement>) => { const canvas = event.currentTarget; const bounds = canvas.getBoundingClientRect(); return { x: (event.clientX - bounds.left) * (canvas.width / bounds.width), y: (event.clientY - bounds.top) * (canvas.height / bounds.height) }; };
    const beginSecretarySignature = (event: React.PointerEvent<HTMLCanvasElement>) => { const canvas = secretarySignatureCanvas.current; if (!canvas)
        return; drawingSecretarySignature.current = true; canvas.setPointerCapture(event.pointerId); const point = signaturePoint(event); const context = canvas.getContext('2d')!; context.beginPath(); context.moveTo(point.x, point.y); };
    const drawSecretarySignature = (event: React.PointerEvent<HTMLCanvasElement>) => { if (!drawingSecretarySignature.current || !secretarySignatureCanvas.current)
        return; const canvas = secretarySignatureCanvas.current; const context = canvas.getContext('2d')!; const point = signaturePoint(event); context.lineWidth = 3; context.lineCap = 'round'; context.strokeStyle = '#111827'; context.lineTo(point.x, point.y); context.stroke(); setSignatureDraft(canvas.toDataURL('image/png')); };
    const clearSecretarySignature = () => { const canvas = secretarySignatureCanvas.current; if (canvas)
        canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height); setSignatureDraft(''); };
    const finishSecretarySignature = () => { if (signatureDraft)
        setSettings(value => ({ ...value, secretary_signature: signatureDraft })); setSecretarySignatureOpen(false); };
    const loadTrash = async () => { const data = await invoke('load-trash'); setTrash(data.documents || []); };
    const moveToTrash = async (item: Protocol) => { await invoke('move-to-trash', { id: item.id }); setProtocols(value => value.filter(protocol => protocol.id !== item.id)); await loadTrash(); };
    const restoreFromTrash = async (item: Protocol) => { const data = await invoke('restore-from-trash', { id: item.id }); setTrash(value => value.filter(protocol => protocol.id !== item.id)); setProtocols(value => [data.document, ...value]); };
    const create = async (event: FormEvent) => {
        event.preventDefault();
        if (!content.trim())
            return;
        setSaving(true);
        try {
            const { PDFDocument, rgb } = await import('pdf-lib');
            const pdf = await PDFDocument.create();
            pdf.registerFontkit(fontkit);
            const font = await pdf.embedFont(Uint8Array.from(atob(ROBOTO_FONT_BASE64), char => char.charCodeAt(0)));
            const w = 595.28, h = 841.89, m = 58;
            let page = pdf.addPage([w, h]);
            let y = h - 58;
            const nextPage = () => { page = pdf.addPage([w, h]); y = h - 58; };
            const write = (value: string, size = 11, gap = 6) => { let row = ''; for (const word of value.trim().split(/\s+/)) {
                const candidate = row ? `${row} ${word}` : word;
                if (font.widthOfTextAtSize(candidate, size) > w - 2 * m && row) {
                    if (y < 70)
                        nextPage();
                    page.drawText(row, { x: m, y, size, font, color: rgb(0, 0, 0) });
                    y -= size + gap;
                    row = word;
                }
                else
                    row = candidate;
            } if (row) {
                if (y < 70)
                    nextPage();
                page.drawText(row, { x: m, y, size, font, color: rgb(0, 0, 0) });
                y -= size + gap;
            } };
            const title = (value: string, size: number, gap: number) => { page.drawText(value, { x: (w - font.widthOfTextAtSize(value, size)) / 2, y, size, font }); y -= size + gap; };
            if (settings.show_church_header) {
                page.drawRectangle({ x: 0, y: h - 78, width: w, height: 78, color: rgb(.14, .13, .13) });
                if (settings.church_header_image?.startsWith('data:image/png')) {
                    const image = await pdf.embedPng(settings.church_header_image);
                    page.drawImage(image, { x: 18, y: h - 70, width: 70, height: 54 });
                }
                const name = settings.church_name || 'Церковь';
                page.drawText(name, { x: 105, y: h - 47, size: 20, font, color: rgb(1, 1, 1) });
                y = h - 108;
            }
            write(dateText(date, time), 10, 28);
            title(`Протокол встречи ${councilName(council, true)}`, 16, 24);
            write(`Место: ${place || '-'}`);
            write(`Присутствовали: ${present.join(', ') || '-'}`);
            write(`Отсутствовали: ${absent.join(', ') || '-'}`);
            y -= 20;
            page.drawLine({ start: { x: m, y }, end: { x: w - m, y }, thickness: .8, color: rgb(.45, .45, .45) });
            y -= 32;
            content.split(/\n+/).filter(Boolean).forEach(p => { write(p, 11, 8); y -= 10; });
            // Signature blocks intentionally stay at the bottom of the final page, rather than directly after short text.
            if (y < 210)
                nextPage();
            const signatureY = 155;
            const secretaryX = m;
            const pastorX = w / 2 + 16;
            const drawSignature = async (signature: string, x: number) => { if (!signature)
                return; const image = await pdf.embedPng(signature); const scale = Math.min(145 / image.width, 52 / image.height); page.drawImage(image, { x, y: signatureY - 66, width: image.width * scale, height: image.height * scale }); };
            await drawSignature(settings.secretary_signature, secretaryX);
            page.drawText(`Протокол составил, секретарь ${council === 'elders' ? 'ПС' : 'церковного совета'}`, { x: secretaryX, y: signatureY + 20, size: 9, font });
            page.drawText(settings.secretary_name || '____________________', { x: secretaryX, y: signatureY, size: 11, font });
            page.drawText('Ведущий пастор церкви', { x: pastorX, y: signatureY + 20, size: 10, font });
            page.drawText(settings.pastor_name || '____________________', { x: pastorX, y: signatureY, size: 11, font });
            const bytes = await pdf.save();
            const data = await invoke('create', { protocol: { council, protocol_date: date, protocol_time: time || null, place, present, absent, content, secretary_name: settings.secretary_name, pastor_name: settings.pastor_name, secretary_signature: settings.secretary_signature || null, pdf_base64: bytesToBase64(bytes) } });
            const filename = `Протокол_${council}_${date}_${Date.now()}.pdf`;
            download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), filename);
            setProtocols(value => [data.document, ...value]);
            setContent('');
            setPresent([]);
            setAbsent([]);
            if (isPublicSubmission) {
                setPublicSubmissionComplete(true);
            }
            else {
                setSection('notifications');
                setTab('main');
            }
        }
        finally {
            setSaving(false);
        }
    };
    const createAnotherPublicProtocol = () => {
        setPublicSubmissionComplete(false);
        setDate(today());
        setTime('');
        setPlace('');
        setPresent([]);
        setAbsent([]);
        setContent('');
        setPicker(null);
    };
    const setArchived = async (protocol: Protocol, archivedValue: boolean) => { await invoke('set-archived', { id: protocol.id, archived: archivedValue }); setProtocols(value => value.map(item => item.id === protocol.id ? { ...item, archived: archivedValue } : item)); };
    const signInToProtocols = async () => { setGoogleLoginLoading(true); const workspaceUrl = `${(import.meta.env.VITE_PROTOCOL_OAUTH_REDIRECT_URL || `${window.location.origin}${import.meta.env.BASE_URL}`).replace(/\/$/, '')}/#/protocols/${encodeURIComponent(token)}`; const { error } = await protocolAuth.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: workspaceUrl } }); if (error) {
        setGoogleLoginLoading(false);
        window.alert(`Не удалось войти через Google: ${error.message}`);
    } };
    const signOutFromProtocols = async () => { await protocolAuth.auth.signOut({ scope: 'local' }); setProtocolUser(null); };
    const connectProtocolGoogleDrive = async () => { if (!protocolUser) {
        window.alert('Сначала войдите через Google.');
        return;
    } const folderUrl = settings.cloud_name.trim(); const clientId = import.meta.env.VITE_PROTOCOL_GOOGLE_DRIVE_CLIENT_ID?.trim(); if (!folderUrl) {
        window.alert('Сначала вставьте ссылку на папку Google Drive.');
        return;
    } if (!clientId) {
        window.alert('Google Drive ещё не настроен администратором приложения.');
        return;
    } try {
        const connections = loadCloudConnections();
        const existingIndex = connections.findIndex(item => item.id === `protocol-google-${token}-${protocolUser.id}`);
        const draft: CloudConnection = existingIndex >= 0 ? { ...connections[existingIndex], enabled: true, deviceEnabled: true, clientId, folderUrl } : { id: `protocol-google-${token}-${protocolUser.id}`, name: 'Google Drive — протоколы', provider: 'google_drive', enabled: true, deviceEnabled: true, clientId, folderUrl };
        const connected = await renewGoogleDriveToken(draft);
        if (existingIndex >= 0)
            connections[existingIndex] = connected;
        else
            connections.push(connected);
        saveCloudConnections(connections);
        setGoogleDriveStatusVersion(value => value + 1);
        window.alert('Google Drive подключён. Теперь нажмите «Выгрузить в облако».');
    }
    catch (error) {
        window.alert(error instanceof Error ? `Не удалось подключить Google Drive: ${error.message}` : 'Не удалось подключить Google Drive');
    } };
    const buildYearZip = async () => { const year = new Date().getFullYear(); const yearlyProtocols = archived.filter(item => item.protocol_date.startsWith(`${year}-`)); if (!yearlyProtocols.length)
        throw new Error(`В архиве нет протоколов за ${year} год`); const zip = new JSZip(); for (const item of yearlyProtocols) {
        const { pdf_url: pdfUrl } = await invoke('get-pdf-url', { id: item.id });
        if (!pdfUrl)
            throw new Error('Не удалось получить свежую ссылку на PDF');
        const month = monthFolders[Number(item.protocol_date.slice(5, 7)) - 1] || 'Без месяца';
        const response = await fetch(pdfUrl);
        if (!response.ok)
            throw new Error(`Не удалось загрузить PDF для архива: HTTP ${response.status}`);
        zip.file(`${year}/${month}/Протокол_${item.council}_${item.protocol_date}_${item.created_at.replace(/[:.]/g, '-')}_${item.id.slice(0, 8)}.pdf`, await response.blob());
    } return { blob: await zip.generateAsync({ type: 'blob' }), name: `Архив_протоколов_${year}.zip` }; };
    const protocolGoogleDriveConnected = useMemo(() => { if (!protocolUser || !settings.cloud_name.trim())
        return false; return googleDriveStatusVersion >= 0 && loadCloudConnections().some(item => item.id === `protocol-google-${token}-${protocolUser.id}` && item.enabled && isCloudEnabledOnDevice(item) && item.folderUrl?.trim() === settings.cloud_name.trim()); }, [googleDriveStatusVersion, protocolUser, settings.cloud_name, token]);
    const openPdf = async (id: string) => { const pdfWindow = window.open('about:blank', '_blank'); setSaving(true); try {
        const { pdf_url: pdfUrl } = await invoke('get-pdf-url', { id });
        if (!pdfUrl)
            throw new Error('Не удалось получить свежую ссылку на PDF');
        if (pdfWindow)
            pdfWindow.location.replace(pdfUrl);
        else
            window.open(pdfUrl, '_blank', 'noopener,noreferrer');
    }
    catch (error) {
        pdfWindow?.close();
        window.alert(error instanceof Error ? error.message : 'Не удалось открыть PDF');
    }
    finally {
        setSaving(false);
    } };
    const makeZip = async () => { setSaving(true); try {
        const archive = await buildYearZip();
        download(archive.blob, archive.name);
    }
    finally {
        setSaving(false);
    } };
    const exportZipToCloud = async () => { setSaving(true); try {
        const connections = loadCloudConnections();
        const targetUrl = settings.cloud_name.trim();
        if (!targetUrl)
            throw new Error('Укажите ссылку на папку Google Drive в настройках протоколов');
        if (!protocolUser)
            throw new Error('Войдите через Google, чтобы выгрузить ZIP в облако');
        const index = connections.findIndex(item => item.id === `protocol-google-${token}-${protocolUser.id}` && item.enabled && isCloudEnabledOnDevice(item) && item.folderUrl?.trim() === targetUrl);
        if (index < 0)
            throw new Error('Для этой папки Google Drive нет подключения на данном устройстве. Добавьте её в настройках облака и нажмите «Подключить Google Drive».');
        let connection = connections[index];
        if (connection.provider === 'google_drive' && !hasCloudCredentials(connection)) {
            connection = await renewGoogleDriveToken(connection);
            connections[index] = connection;
            saveCloudConnections(connections);
        }
        if (!hasCloudCredentials(connection))
            throw new Error(`Нет авторизации для «${connection.name}». Подключите это облако на данном устройстве.`);
        const archive = await buildYearZip();
        await uploadCloudArchive(connection, archive.name, archive.blob);
        window.alert(`ZIP-архив выгружен в ${connection.name}`);
    }
    catch (error) {
        window.alert(error instanceof Error ? error.message : 'Не удалось выгрузить ZIP-архив');
    }
    finally {
        setSaving(false);
    } };
    if (valid === null)
        return <main className="grid min-h-screen place-items-center">Загрузка…</main>;
    if (!valid)
        return <main className="grid min-h-screen place-items-center text-destructive">Ссылка не найдена или отключена.</main>;
    const nav = (id: Section, label: string, Icon: typeof FileText) => <button title={label} onClick={() => { setSection(id); setSidebarOpen(false); if (id === 'trash')
        void loadTrash(); }} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${sidebarCollapsed ? 'md:justify-center md:px-2' : ''} ${section === id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}><Icon className="h-4 w-4 shrink-0"/><span className={sidebarCollapsed ? 'md:hidden' : ''}>{label}</span></button>;
    const signingUrl = (item: Protocol) => `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/#/protocols/${encodeURIComponent(token)}/sign/${item.pastor_sign_token}`;
    const googleSheetTargetUrl = () => {
        const sourceUrl = settings.google_sheet_url.trim();
        const sheetName = settings.google_sheet_name.trim();
        const range = settings.google_sheet_range.trim();
        if (!sourceUrl || (!sheetName && !range)) return sourceUrl;
        const targetRange = range.includes('!') ? range : [sheetName, range].filter(Boolean).join('!');
        try {
            const url = new URL(sourceUrl);
            return `${url.toString()}${url.hash ? '&' : '#'}range=${encodeURIComponent(targetRange)}`;
        }
        catch {
            return sourceUrl;
        }
    };
    const list = (items: Protocol[], isArchive: boolean) => <div className="space-y-3">{items.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{isArchive ? 'В архиве пока нет протоколов.' : 'Сохранённые PDF-протоколы появятся здесь.'}</p> : items.map(item => <article key={item.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">Протокол {councilName(item.council)}</p><p className="text-sm text-muted-foreground">{dateText(item.protocol_date, item.protocol_time)} · {item.place || 'место не указано'}</p>{item.pastor_signed_at ? <p className="mt-1 text-xs text-green-700">Подписано ведущим пастором</p> : <p className="mt-1 text-xs text-muted-foreground">Ожидает подписи ведущего пастора</p>}</div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={saving} onClick={() => void openPdf(item.id)}><Download className="mr-1 h-4 w-4"/>PDF</Button><Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" title="Переместить в корзину" onClick={() => void moveToTrash(item)}><X className="h-4 w-4"/></Button>{!item.pastor_signed_at && item.pastor_sign_token && <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(signingUrl(item))}>Скопировать ссылку подписи</Button>}{!isArchive && <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText([item.protocol_date, councilName(item.council), item.present.join(', '), item.content.replace(/\n/g, ' ')].join('\t')).then(() => googleSheetTargetUrl() && window.open(googleSheetTargetUrl(), '_blank', 'noopener,noreferrer'))}><Table2 className="mr-1 h-4 w-4"/>Google Sheets</Button>}<Button size="sm" variant="outline" onClick={() => void setArchived(item, !isArchive)}>{isArchive ? 'Вернуть' : 'В архив'}</Button></div></div></article>)}</div>;
    return <main className="min-h-screen bg-muted/30"><header className="sticky top-0 z-40 border-b bg-card/95 shadow-sm backdrop-blur"><div className="flex h-14 items-center justify-between px-3 sm:px-5"><div className="flex items-center gap-2 font-semibold"><FileText className="h-5 w-5 text-primary"/><span>Церковный учет — Протоколы</span></div><Button type="button" variant="outline" size="sm" onClick={() => void hardReload()} title="Обновить приложение (Ctrl+Shift+R)"><RefreshCw className="mr-2 h-4 w-4"/>Обновить</Button></div></header><div className="flex min-h-[calc(100vh-3.5rem)] w-full">{!isPublicSubmission && <aside className={`fixed inset-y-14 left-0 z-30 w-64 shrink-0 border-r bg-card p-4 transition-[transform,width] md:sticky md:top-14 md:h-[calc(100vh-3.5rem)] md:translate-x-0 ${sidebarCollapsed ? 'md:w-16' : 'md:w-56'} ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}><div className={`mb-6 flex items-center gap-2 font-semibold ${sidebarCollapsed ? 'md:justify-center' : ''}`}><FileText className="h-5 w-5 shrink-0 text-primary"/><span className={sidebarCollapsed ? 'md:hidden' : ''}>Протоколы</span><button type="button" title="Свернуть или развернуть меню" aria-label="Свернуть или развернуть меню" className="ml-auto hidden rounded p-1 hover:bg-muted md:block" onClick={() => setSidebarCollapsed(value => !value)}><Menu className="h-4 w-4"/></button></div><nav className="space-y-1">{nav('create', 'Создать протокол', FileText)}{nav('settings', 'Настройки', Settings)}{nav('notifications', 'Уведомления', Bell)}<div className="mt-5 border-t pt-4">{nav('trash', 'Корзина', Trash2)}{nav('account', 'Аккаунт', CircleUserRound)}</div></nav></aside>}{!isPublicSubmission && sidebarOpen && <button aria-label="Закрыть меню" className="fixed inset-0 z-20 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)}/>}<section className="min-w-0 flex-1 p-3 pb-24 sm:p-5 md:p-8 xl:p-10">{isPublicSubmission && publicSubmissionComplete ? <div className="mx-auto w-full max-w-xl space-y-5 rounded-xl border bg-card p-6 text-center shadow-sm sm:p-8"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10"><Check className="h-6 w-6 text-primary"/></div><div><h1 className="text-2xl font-bold">Протокол успешно отправлен</h1><p className="mt-2 text-muted-foreground">Спасибо. Если нужно заполнить ещё один протокол, нажмите кнопку ниже.</p></div><Button type="button" onClick={createAnotherPublicProtocol}>Создать ещё протокол</Button></div> : <>{!isPublicSubmission && <><div className="mb-4 flex items-center gap-2 md:hidden"><Button type="button" variant="outline" size="icon" onClick={() => setSidebarOpen(true)}><Menu className="h-5 w-5"/></Button><span className="font-semibold">Протоколы</span></div><div className="mb-4 flex justify-end"><ProtocolPwaInstall token={token}/></div></>}{section === 'create' && <form onSubmit={create} className="w-full max-w-6xl space-y-5 rounded-xl border bg-card p-5 shadow-sm sm:p-8"><div><h1 className="text-2xl font-bold">Создать протокол</h1><p className="mt-1 text-muted-foreground">Поля документа соответствуют утверждённому шаблону протокола.</p></div><div className="grid gap-4 sm:grid-cols-3"><label className="space-y-2 text-sm font-medium">Тип совета<select value={council} onChange={e => setCouncil(e.target.value as Council)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{settings.councils.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="space-y-2 text-sm font-medium">Дата<Input type="date" value={date} onChange={e => setDate(e.target.value)} required/></label><label className="space-y-2 text-sm font-medium">Время<Input type="time" value={time} onChange={e => setTime(e.target.value)}/></label></div><label className="space-y-2 text-sm font-medium block">Место<Input value={place} onChange={e => setPlace(e.target.value)} placeholder="Например: Telegram"/></label><div className="space-y-2"><label className="text-sm font-medium">Участники</label><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setPicker(picker === 'present' ? null : 'present')}><Users className="mr-2 h-4 w-4"/>Добавить присутствующих</Button><Button type="button" variant="outline" onClick={() => setPicker(picker === 'absent' ? null : 'absent')}>Добавить отсутствующих</Button><Button type="button" variant="outline" onClick={() => setShowOtherCouncilPeople(value => !value)}>Больше</Button></div>{picker && <div className="space-y-3 rounded-lg border p-3">{visibleParticipantCouncils.map(group => <div key={group.id}><p className="mb-2 text-xs font-medium text-muted-foreground">{group.name}{group.id === selectedCouncil?.id ? '' : ' · другой совет'}</p><div className="grid gap-2 sm:grid-cols-2">{group.attendees.map(person => <label key={`${group.id}-${person}`} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={(picker === 'present' ? present : absent).includes(person)} onChange={() => toggle(person, picker)}/>{person}</label>)}</div></div>)}{visibleParticipantCouncils.every(group => group.attendees.length === 0) && <p className="text-sm text-muted-foreground">Добавьте людей в настройках.</p>}</div>}<p className="text-sm text-muted-foreground">Присутствовали: {present.join(', ') || '—'}<br />Отсутствовали: {absent.join(', ') || '—'}</p></div><div className="space-y-2"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">Текст протокола / решения</span><Button type="button" variant="outline" size="sm" onClick={() => insertTextFormat('— ')}>—</Button><Button type="button" variant="outline" size="sm" title="Маркер списка" aria-label="Маркер списка" onClick={() => insertTextFormat('• ')}>•</Button><select defaultValue="" title="Вставить номер" aria-label="Вставить номер" className="h-9 rounded-md border border-input bg-background px-2 text-sm" onChange={e => { if (e.currentTarget.value) {
        insertTextFormat(`${e.currentTarget.value}. `);
        e.currentTarget.value = '';
    } }}><option value="" disabled>0–9</option>{Array.from({ length: 10 }, (_, number) => <option key={number} value={number}>{number}.</option>)}</select></div><Textarea ref={contentEditor} value={content} onChange={e => setContent(e.target.value)} rows={9} required/><p className="text-xs text-muted-foreground">Выберите формат — он вставится в место курсора или перед выбранными строками и сохранится в PDF без изменений.</p></div>{!isPublicSubmission && <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-sm font-medium">Секретарь<Input value={settings.secretary_name} readOnly aria-readonly="true"/></label><label className="space-y-2 text-sm font-medium">Ведущий пастор<Input value={settings.pastor_name} readOnly aria-readonly="true"/></label><p className="sm:col-span-2 text-xs text-muted-foreground">Подпись секретаря добавляется из настроек. После сохранения PDF появится одноразовая ссылка для подписи ведущего пастора.</p></div>}<Button type="submit" className="gap-2" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin"/> : <FileDown className="h-4 w-4"/>}{isPublicSubmission ? 'Отправить' : 'Сохранить PDF'}</Button></form>}{section === 'account' && <div className="w-full max-w-4xl space-y-5 rounded-xl border bg-card p-5 shadow-sm sm:p-8"><div><h1 className="text-2xl font-bold">Аккаунт протоколов</h1><p className="mt-1 text-muted-foreground">Этот вход используется только для протоколов и не влияет на вход в церковные финансы. После входа будут загружены настройки и PDF этого аккаунта.</p></div>{authLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Проверяем вход…</div> : protocolUser ? <div className="space-y-4 rounded-lg border p-4"><div><p className="text-sm text-muted-foreground">Вошли через Google</p><p className="font-medium">{protocolUser.email || 'Google аккаунт'}</p></div><Button type="button" variant="outline" onClick={() => void signOutFromProtocols()}><LogOut className="mr-2 h-4 w-4"/>Выйти из протоколов</Button></div> : <div className="space-y-3 rounded-lg border p-4"><p className="text-sm text-muted-foreground">Войдите через Google, чтобы подключить облако и выгружать ZIP-архивы от имени своего аккаунта.</p><Button type="button" onClick={() => void signInToProtocols()} disabled={googleLoginLoading}>{googleLoginLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <LogIn className="mr-2 h-4 w-4"/>}Войти через Google</Button></div>}</div>}{section === 'settings' && <div className="w-full max-w-6xl space-y-5 rounded-xl border bg-card p-5 shadow-sm sm:p-8"><div><h1 className="text-2xl font-bold">Настройки</h1><p className="mt-1 text-muted-foreground">Настройки и файлы сохраняются отдельно для этого аккаунта протоколов.</p></div><div className="rounded-lg border border-primary/30 bg-primary/5 p-4"><p className="font-medium">Публичная ссылка для заполнения протокола</p><p className="mt-1 text-sm text-muted-foreground">Отправьте её участнику: он заполнит форму без входа, а PDF появится в ваших протоколах.</p><div className="mt-3 flex flex-wrap gap-2"><Input readOnly value={publicProtocolUrl} className="min-w-0 flex-1"/><Button type="button" onClick={() => void navigator.clipboard.writeText(publicProtocolUrl)}>Копировать</Button></div></div><details className="overflow-hidden rounded-xl border bg-background"><summary className="cursor-pointer list-none px-4 py-4 text-sm font-semibold">Советы и участники <span className="float-right text-muted-foreground">⌄</span></summary><div className="space-y-3 border-t p-4"><div className="flex flex-col gap-2 sm:flex-row"><Input value={newCouncil} onChange={e => setNewCouncil(e.target.value)} placeholder="Название нового совета"/><Button type="button" onClick={addCouncil}><Plus className="mr-1 h-4 w-4"/>Добавить</Button></div><div className="flex flex-wrap gap-2">{settings.councils.map(item => <span key={item.id} className={`flex items-center rounded-full border px-3 py-1 text-sm ${item.id === council ? 'border-primary' : ''}`}><button type="button" onClick={() => setCouncil(item.id)}>{item.name}</button>{settings.councils.length > 1 && <button type="button" className="ml-2 text-destructive" onClick={() => removeCouncil(item.id)}><X className="h-3 w-3"/></button>}</span>)}</div><div className="mt-5 space-y-2 border-t pt-5"><label className="text-sm font-medium">Участники: {selectedCouncil?.name || 'Совет'}</label><div className="flex flex-col gap-2 sm:flex-row"><Input value={newPerson} onChange={e => setNewPerson(e.target.value)} placeholder="Имя и фамилия"/><Button type="button" onClick={addPerson}><Plus className="mr-1 h-4 w-4"/>Добавить</Button></div><div className="flex flex-wrap gap-2">{(selectedCouncil?.attendees || []).map(person => <span key={person} className="flex items-center rounded-full border px-3 py-1 text-sm">{person}<button type="button" className="ml-2 text-destructive" onClick={() => setSettings(value => ({ ...value, councils: value.councils.map(item => item.id === selectedCouncil?.id ? { ...item, attendees: item.attendees.filter(member => member !== person) } : item) }))}><X className="h-3 w-3"/></button></span>)}</div></div></div></details><details className="overflow-hidden rounded-xl border bg-background"><summary className="cursor-pointer list-none px-4 py-4 text-sm font-semibold">Подписи и ответственные <span className="float-right text-muted-foreground">⌄</span></summary><div className="grid gap-4 border-t p-4 sm:grid-cols-2"><label className="space-y-2 text-sm font-medium">Секретарь по умолчанию<Input value={settings.secretary_name} onChange={e => setSettings(value => ({ ...value, secretary_name: e.target.value }))}/></label><label className="space-y-2 text-sm font-medium">Ведущий пастор по умолчанию<Input value={settings.pastor_name} onChange={e => setSettings(value => ({ ...value, pastor_name: e.target.value }))}/></label><div className="space-y-2 sm:col-span-2"><div className="flex items-center gap-2"><Button type="button" variant="outline" onClick={() => { setSignatureDraft('' ); setSecretarySignatureOpen(value => !value); }}>Подпись секретаря</Button>{settings.secretary_signature && <img src={settings.secretary_signature} alt="Подпись секретаря" className="h-10 w-24 rounded border bg-white object-contain p-1" />}</div><span className="block text-xs text-muted-foreground">Нарисуйте подпись — она автоматически добавится в новые протоколы.</span>{secretarySignatureOpen && <div className="rounded-lg border p-3"><div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium">Podpis / Подпись</span><Button type="button" variant="ghost" size="sm" onClick={clearSecretarySignature}>Очистить</Button></div><canvas ref={secretarySignatureCanvas} width={700} height={220} className="h-40 w-full touch-none rounded-md border bg-white" onPointerDown={beginSecretarySignature} onPointerMove={drawSecretarySignature} onPointerUp={() => { drawingSecretarySignature.current = false; }} onPointerCancel={() => { drawingSecretarySignature.current = false; }}/><div className="mt-3 flex justify-end"><Button type="button" onClick={finishSecretarySignature} disabled={!signatureDraft}><Check className="mr-2 h-4 w-4"/>Готово</Button></div>{settings.secretary_signature && <p className="mt-2 text-xs text-muted-foreground">Подпись сохранена и будет добавлена в PDF.</p>}</div>}</div></div></details><details className="overflow-hidden rounded-xl border bg-background"><summary className="cursor-pointer list-none px-4 py-4 text-sm font-semibold">Google Таблица <span className="float-right text-muted-foreground">⌄</span></summary><div className="grid gap-4 border-t p-4 sm:grid-cols-2"><label className="space-y-2 text-sm font-medium sm:col-span-2">Ссылка на Google Sheets<Input value={settings.google_sheet_url} onChange={e => setSettings(value => ({ ...value, google_sheet_url: e.target.value }))} placeholder="https://docs.google.com/spreadsheets/..."/></label><label className="space-y-2 text-sm font-medium">Название листа<Input value={settings.google_sheet_name} onChange={e => setSettings(value => ({ ...value, google_sheet_name: e.target.value }))} placeholder="Например: Протоколы"/></label><label className="space-y-2 text-sm font-medium">Диапазон<Input value={settings.google_sheet_range} onChange={e => setSettings(value => ({ ...value, google_sheet_range: e.target.value }))} placeholder="Например: A2:H"/></label><p className="text-xs text-muted-foreground sm:col-span-2">При выгрузке откроется указанный лист и диапазон. Можно указать полный диапазон вместе с листом, например «Протоколы!A2:H».</p></div></details><details className="overflow-hidden rounded-xl border bg-background"><summary className="cursor-pointer list-none px-4 py-4 text-sm font-semibold">Google Drive и ZIP-архив <span className="float-right text-muted-foreground">⌄</span></summary><div className="space-y-2 border-t p-4"><label className="space-y-2 text-sm font-medium block">Папка Google Drive для ZIP-архива<Input value={settings.cloud_name} onChange={e => setSettings(value => ({ ...value, cloud_name: e.target.value }))} placeholder="https://drive.google.com/drive/folders/..."/></label><div className="flex flex-wrap items-center gap-2"><p className="text-xs text-muted-foreground">При подключении Google Drive будет использован единый аккаунт приложения.</p><span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${protocolGoogleDriveConnected ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600' : 'text-muted-foreground'}`}>{protocolGoogleDriveConnected ? <><Check className="h-3.5 w-3.5"/>Google Drive подключён</> : <><X className="h-3.5 w-3.5"/>Google Drive не подключён</>}</span></div><div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" disabled={saving} onClick={() => void connectProtocolGoogleDrive()}><CloudUpload className="mr-2 h-4 w-4"/>Подключить Google Drive</Button><span className="text-xs text-muted-foreground">Подключение требуется один раз на этом устройстве.</span></div></div></details><Button disabled={saving} onClick={() => void saveSettings()}>Сохранить настройки</Button></div>}{section === 'notifications' && <div className="w-full max-w-6xl space-y-5"><div><h1 className="text-2xl font-bold">Уведомления</h1><p className="mt-1 text-muted-foreground">Сохранённые PDF-протоколы и архив документов.</p></div><div className="flex gap-2"><Button variant={tab === 'main' ? 'default' : 'outline'} onClick={() => setTab('main')}>Основной</Button><Button variant={tab === 'archive' ? 'default' : 'outline'} onClick={() => setTab('archive')}>Архив</Button>{tab === 'archive' && archived.length > 0 && <div className="ml-auto flex flex-wrap gap-2"><Button variant="outline" disabled={saving} onClick={() => void exportZipToCloud()}><CloudUpload className="mr-2 h-4 w-4"/>Выгрузить в облако</Button><Button disabled={saving} onClick={() => void makeZip()}><Archive className="mr-2 h-4 w-4"/>Скачать ZIP</Button></div>}</div>{tab === 'main' ? list(active, false) : <div className="space-y-3">{Object.entries(archiveYears).sort(([a], [b]) => b.localeCompare(a)).map(([year, items]) => <div key={year} className="overflow-hidden rounded-xl border bg-card"><button type="button" className="flex w-full items-center gap-3 p-4 text-left" onClick={() => setOpenYears(value => value.includes(year) ? value.filter(item => item !== year) : [...value, year])}><Archive className="h-5 w-5 text-primary"/><div className="flex-1"><p className="font-semibold">{year} протоколы</p><p className="text-xs text-muted-foreground">PDF-файлов: {items.length}</p></div><span className="text-muted-foreground">{openYears.includes(year) ? '⌃' : '⌄'}</span></button>{openYears.includes(year) && <div className="border-t p-3">{list(items, true)}</div>}</div>)}</div>}</div>}{section === 'trash' && <div className="w-full max-w-6xl space-y-5"><div className="flex items-start justify-between gap-3"><div><h1 className="text-2xl font-bold">Корзина</h1><p className="mt-1 text-muted-foreground">Удалённые протоколы можно восстановить в течение 2 дней.</p></div><Button variant="outline" size="icon" title="Обновить корзину" onClick={() => void loadTrash()}><RotateCcw className="h-4 w-4"/></Button></div><div className="space-y-3">{trash.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Корзина пуста.</p> : trash.map(item => <article key={item.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">Протокол {councilName(item.council)}</p><p className="text-sm text-muted-foreground">Удалён: {item.deleted_at ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.deleted_at)) : '—'}</p></div><Button size="sm" variant="outline" onClick={() => void restoreFromTrash(item)}><RotateCcw className="mr-1 h-4 w-4"/>Восстановить</Button></div></article>)}</div></div>}{!isPublicSubmission && <nav aria-label="Быстрая навигация" className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t bg-card/95 p-2 backdrop-blur md:hidden">{([['create', 'Создать', FileText], ['settings', 'Настройки', Settings], ['notifications', 'Уведомления', Bell], ['trash', 'Корзина', Trash2], ['account', 'Аккаунт', CircleUserRound]] as Array<[
        Section,
        string,
        typeof FileText
    ]>).map(([id, label, Icon]) => <button key={id} type="button" onClick={() => { setSection(id); if (id === 'trash')
        void loadTrash(); }} className={`flex flex-col items-center gap-1 rounded-md py-1 text-[11px] ${section === id ? 'text-primary' : 'text-muted-foreground'}`}><Icon className="h-5 w-5"/>{label}</button>)}</nav>}</section></div></main>;
}
