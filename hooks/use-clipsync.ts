'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { backend, publicConfiguration } from '@/lib/supabase';
import { clipboardSchema, type Clip, type Device } from '@/lib/clipboard';
import { useSessionPause } from './use-browser-state';
export function useClipsync() {
  const [user, setUser] = useState<User | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(Boolean(backend));
  const [status, setStatus] = useState(publicConfiguration.error ? 'Configuration error' : 'Waiting for setup');
  const [notice, setNotice] = useState('');
  const [paused, setPaused] = useSessionPause();
  const [history, setHistory] = useState(false);
  const [retention, setRetention] = useState(7);
  const [deviceId, setDeviceId] = useState('');
  const [pulse, setPulse] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const confirmed = useRef(false);
  const pendingReceipt = useRef(new Set<string>());
  const sessionEpoch = useRef(0);
  const notify = useCallback((message: string) => { setNotice(message); window.dispatchEvent(new CustomEvent('clipsync-notice', { detail: message })); }, []);
  useEffect(() => { const timer = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer); }, [notice]);
  const refresh = useCallback(async () => {
    if (!backend) return;
    const epoch = sessionEpoch.current;
    const results = await Promise.all([backend.from('devices').select('*').order('last_seen', { ascending: false }), backend.from('clips').select('*, clip_receipts(device_id)').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(100), backend.from('profiles').select('history_enabled,retention_days').single()]);
    if (epoch !== sessionEpoch.current) return;
    if (results.some(result => result.error)) { setStatus('Connection error'); notify(results.find(result => result.error)?.error?.message || 'Unable to load data'); }
    else { setDevices(results[0].data || []); setClips(results[1].data || []); setHistory(results[2].data?.history_enabled ?? false); setRetention(results[2].data?.retention_days ?? 7); }
    setLoading(false);
  }, [notify]);
  useEffect(() => {
    if (!backend) return;
    const client = backend;
    let active = true;
    client.auth.getUser().then(({ data, error }) => { if (!active) return; setUser(data.user ?? null); if (data.user) setDeviceId(localStorage.getItem('clipsync-device-' + data.user.id) || ''); if (!data.user) { setLoading(false); setStatus(error ? 'Sign in required' : 'Not signed in'); } }).catch(() => { if (active) { setLoading(false); setStatus('Authentication unavailable'); } });
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => { sessionEpoch.current += 1; setUser(session?.user ?? null); if (session) setDeviceId(localStorage.getItem('clipsync-device-' + session.user.id) || ''); else { setClips([]); setDevices([]); setDeviceId(''); confirmed.current = false; setHistory(false); setStatus('Sign in required'); setLoading(false); } });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!user || !backend) return;
    const client = backend;
    const stored = deviceId;
    const channel = client.channel('account-' + user.id).on('postgres_changes', { event: '*', schema: 'public', table: 'clips', filter: 'user_id=eq.' + user.id }, () => { void refresh(); }).on('postgres_changes', { event: '*', schema: 'public', table: 'devices', filter: 'user_id=eq.' + user.id }, () => { void refresh(); }).on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: 'id=eq.' + user.id }, () => { void refresh(); }).subscribe(state => { setStatus(state === 'SUBSCRIBED' ? 'Connected' : ['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(state) ? 'Reconnecting' : 'Connecting'); if (state !== 'CLOSED') void refresh(); });
    const visibility = () => { if (document.visibilityState === 'hidden') setClips([]); else void refresh(); };
    const online = () => { setStatus('Reconnecting'); void refresh(); };
    const offline = () => { setStatus('Device offline'); };
    window.addEventListener('online', online); window.addEventListener('offline', offline); document.addEventListener('visibilitychange', visibility);
    const interval = setInterval(() => { void refresh(); if (stored && !paused && document.visibilityState === 'visible') void client.rpc('heartbeat', { target_device: stored }); }, 30000);
    return () => { sessionEpoch.current += 1; clearInterval(interval); window.removeEventListener('online', online); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', visibility); void client.removeChannel(channel); };
  }, [user, refresh, paused, deviceId]);
  useEffect(() => {
    const device = devices.find(item => item.id === deviceId);
    confirmed.current = Boolean(device && !device.revoked);
    if (!confirmed.current || paused || !backend) return;
    const incoming = clips.find(item => item.device_id !== deviceId && !item.clip_receipts?.some(receipt => receipt.device_id === deviceId) && !pendingReceipt.current.has(item.id));
    if (incoming && document.visibilityState === 'visible') {
      pendingReceipt.current.add(incoming.id);
      void backend.rpc('acknowledge_clip', { clip_id: incoming.id, target_device: deviceId }).then(({ data, error }) => { pendingReceipt.current.delete(incoming.id); if (!error && data === true) { notify('New clip received. Choose Copy to use it on this device.'); setPulse(true); setTimeout(() => setPulse(false), 1000); void refresh(); } });
    }
  }, [clips, devices, deviceId, paused, notify, refresh]);
  async function send(text: string) {
    const parsed = clipboardSchema.safeParse({ text });
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);
    if (!backend || !user) throw new Error('Sign in to a configured workspace to send a clip.');
    if (!confirmed.current) throw new Error('Authorize this browser in Devices first.');
    if (paused) throw new Error('Resume synchronization before sending.');
    if (!navigator.onLine) throw new Error('You are offline. Reconnect before sending. No offline clipboard queue is stored.');
    if (!devices.some(device => device.id !== deviceId && !device.revoked)) throw new Error('Pair another device before sending.');
    setStatus('Syncing');
    const { error } = await backend.rpc('send_clip', { target_device: deviceId, clip_content: parsed.data.text, keep_history: history, retention_days: retention });
    if (error) { setStatus('Send failed'); throw error; }
    setStatus('Sent · awaiting receipt'); setEvents(previous => ['Clip accepted by server', ...previous].slice(0, 30));
    notify('Sent securely to your paired devices. Receipt is shown when another device acknowledges it.'); await refresh();
  }
  async function mutate(operation: 'pin' | 'delete' | 'clear' | 'revoke' | 'rename', id?: string, value?: string | boolean) {
    if (!backend || !user) throw new Error('Sign in first.');
    let result;
    if (operation === 'clear') result = await backend.from('clips').delete().eq('user_id', user.id);
    else if (operation === 'delete') result = await backend.from('clips').delete().eq('id', id!);
    else if (operation === 'pin') result = await backend.from('clips').update({ pinned: value }).eq('id', id!);
    else result = await backend.from('devices').update(operation === 'revoke' ? { revoked: true } : { name: value }).eq('id', id!);
    if (result.error) throw result.error; await refresh();
  }
  async function preferences(enabled: boolean, days: number) {
    if (!backend || !user) throw new Error('Sign in to save preferences.');
    const { error } = await backend.rpc('set_preferences', { history_enabled: enabled, retention_days: days });
    if (error) throw error; setHistory(enabled); setRetention(days); await refresh(); notify('Privacy preferences saved.');
  }
  async function pairing(action: 'create' | 'join' | 'confirm', code?: string, name?: string, platform?: string, joiningDevice?: string) {
    if (!backend || !user) throw new Error('Sign in to a configured workspace to pair devices.');
    const { data, error } = await backend.rpc(action === 'create' ? 'create_pairing' : action === 'join' ? 'join_pairing' : 'confirm_pairing', action === 'create' ? { device_name: name, device_platform: platform } : action === 'join' ? { pairing_code: code, joining_device: joiningDevice || localStorage.getItem('clipsync-device-' + user.id) } : { pairing_code: code });
    if (error) throw error;
    if (action !== 'confirm' && data.device_id) { localStorage.setItem('clipsync-device-' + user.id, data.device_id); setDeviceId(data.device_id); }
    await refresh(); return data;
  }
  return { user, clips, devices, loading, status: paused ? 'Sync paused' : devices.some(device => device.id === deviceId && device.revoked) ? 'Device access revoked' : status, notice, notify, paused, setPaused, history, retention, deviceId, pulse, events, send, mutate, preferences, pairing, refresh, configured: Boolean(backend) };
}
