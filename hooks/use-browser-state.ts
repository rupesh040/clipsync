'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';

const noSubscription = () => () => {};
export function useHydrated() { return useSyncExternalStore(noSubscription, () => true, () => false); }

function subscribePause(listener: () => void) {
  window.addEventListener('clipsync-pause', listener);
  window.addEventListener('storage', listener);
  return () => { window.removeEventListener('clipsync-pause', listener); window.removeEventListener('storage', listener); };
}
function pauseSnapshot() { return sessionStorage.getItem('clipsync-paused') === 'true'; }
export function useSessionPause() {
  const paused = useSyncExternalStore(subscribePause, pauseSnapshot, () => false);
  const setPaused = (value: boolean) => { sessionStorage.setItem('clipsync-paused', String(value)); window.dispatchEvent(new Event('clipsync-pause')); };
  return [paused, setPaused] as const;
}

export function useClock() {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const initial = setTimeout(update, 0);
    const timer = setInterval(update, 30000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, []);
  return now;
}

function subscribeTheme(listener: () => void) {
  window.addEventListener('clipsync-theme', listener);
  window.addEventListener('storage', listener);
  return () => { window.removeEventListener('clipsync-theme', listener); window.removeEventListener('storage', listener); };
}
function themeSnapshot() {
  const value = localStorage.getItem('clipsync-theme');
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function useBrowserTheme() {
  const theme = useSyncExternalStore(subscribeTheme, themeSnapshot, () => 'system');
  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)');
    const update = () => { document.documentElement.dataset.theme = theme === 'system' ? (system.matches ? 'dark' : 'light') : theme; };
    update();
    system.addEventListener('change',update);
    return () => system.removeEventListener('change',update);
  }, [theme]);
  const applyTheme = (value: string) => { localStorage.setItem('clipsync-theme', value); window.dispatchEvent(new Event('clipsync-theme')); };
  return [theme, applyTheme] as const;
}
