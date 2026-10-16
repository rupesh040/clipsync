'use client';
import { useEffect, useRef, useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import { installationPlatform, type InstallPromptEvent } from '@/lib/pwa';
import { useHydrated } from '@/hooks/use-browser-state';

export function InstallApp() {
  const [installed, setInstalled] = useState(false);
  const ready = useHydrated();
  const [instructions, setInstructions] = useState(false);
  const platform = ready ? installationPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints) : 'desktop';
  const [message, setMessage] = useState('');
  const prompt = useRef<InstallPromptEvent | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const standalone = matchMedia('(display-mode: standalone)');
    const update = () => setInstalled(standalone.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const initial = setTimeout(update, 0);
    const available = (event: Event) => { event.preventDefault(); prompt.current = event as InstallPromptEvent; };
    const completed = () => { prompt.current = null; setInstalled(true); setInstructions(false); };
    window.addEventListener('beforeinstallprompt', available);
    window.addEventListener('appinstalled', completed);
    standalone.addEventListener('change', update);
    if ('serviceWorker' in navigator && window.isSecureContext && process.env.NODE_ENV === 'production') {
      void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => setMessage('Offline support could not be enabled. You can still use Clipsync online.'));
    }
    return () => { clearTimeout(initial); window.removeEventListener('beforeinstallprompt', available); window.removeEventListener('appinstalled', completed); standalone.removeEventListener('change', update); };
  }, []);

  useEffect(() => {
    if (instructions) dialog.current?.showModal();
    else if (dialog.current?.open) { dialog.current.close(); trigger.current?.focus(); }
  }, [instructions]);

  async function install() {
    if (!prompt.current) { setInstructions(true); return; }
    const event = prompt.current;
    prompt.current = null;
    try {
      await event.prompt();
      const choice = await event.userChoice;
      setMessage(choice.outcome === 'accepted' ? 'Installation requested. Your browser will confirm when it is complete.' : 'Installation dismissed. You can install Clipsync later.');
    } catch { setInstructions(true); }
  }

  if (!ready || installed) return null;
  return <div className="install-widget">
    <button ref={trigger} className="button green install-trigger" onClick={() => void install()}><Download size={16}/><span>Install App</span></button>
    {message && <div className="install-feedback" role="status">{message}<button className="icon-button" aria-label="Dismiss installation message" onClick={() => setMessage('')}><X size={15}/></button></div>}
    <dialog ref={dialog} aria-labelledby="install-title" onCancel={() => setInstructions(false)} onClick={event => { if (event.target === event.currentTarget) setInstructions(false); }}>
      <div className="dialog-heading"><h2 id="install-title">A place on your home screen.</h2><button className="icon-button" aria-label="Close installation instructions" onClick={() => setInstructions(false)}><X size={20}/></button></div>
      <Smartphone size={34} className="green-text"/>
      {platform === 'ios' ? <><p>On iPhone or iPad, open this site in Safari.</p><ol><li>Tap the Share button.</li><li>Choose Add to Home Screen.</li><li>If shown, enable Open as Web App, then tap Add.</li></ol></> : platform === 'android' ? <><p>In Chrome on Android, open the browser menu (⋮), then choose Install app or Add to Home screen and follow the browser’s instructions.</p><p>The native prompt becomes available when the browser determines this site is installable. In-app browsers may require opening the site in Chrome first.</p></> : <p>In Chrome or Edge, use the install icon in the address bar or the browser menu’s Install app option. On supported Safari versions, choose File → Add to Dock. Some browsers only support bookmarks.</p>}
      <p className="small-note">Installation adds this web app through your browser. It does not create an APK or IPA, or enable unrestricted background clipboard access. Keep the app open and use Send and Copy.</p>
      <button className="button full-width" onClick={() => setInstructions(false)}>Got it</button>
    </dialog>
  </div>;
}
