'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { backend } from '@/lib/supabase';
import { clipboardSchema, type Clip, type Device } from '@/lib/clipboard';
export function useClipsync() {
  const [user, setUser] = useState<User | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('Waiting for setup');
  const [notice, setNotice] = useState('');
  const [paused, setPaused] = useState(false);
  const [history, setHistory] = useState(false);
  const [retention, setRetention] = useState(7);
  const [deviceId, setDeviceId] = useState('');
  const [pulse, setPulse] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const confirmed = useRef(false);
  const notify = useCallback((message: string) => { setNotice(message); window.dispatchEvent(new CustomEvent('clipsync-notice', { detail: message })); }, []);
  useEffect(() => { const timer = setTimeout(() => setNotice(''), 6000); return () => clearTimeout(timer); }, [notice]);
  const refresh = useCallback(async () => {
    if (!backend) { setLoading(false); return; }
    const results = await Promise.all([backend.from('devices').select('*').order('last_seen', { ascending: false }), backend.from('clips').select('*').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(100)]);
    if (results.some(result => result.error)) { setStatus('Connection error'); notify(results.find(result => result.error)?.error?.message || 'Unable to load data'); }
    else { setDevices(results[0].data || []); setClips(results[1].data || []); }
    setLoading(false);
  }, [notify]);
  useEffect(() => {
    if (!backend) { setLoading(false); return; }
    const client = backend;
    client.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); if (!data.session) setLoading(false); });
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => listener.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!user || !backend) return;
    const client = backend;
    const settings = user.user_metadata;
    setHistory(Boolean(settings.history)); setRetention(settings.retention || 7);
    const stored = localStorage.getItem('clipsync-device-' + user.id);
    if (stored) setDeviceId(stored);
    void refresh();
    const channel = client.channel('account-' + user.id).on('postgres_changes', { event: '*', schema: 'public', table: 'clips', filter: 'user_id=eq.' + user.id }, () => { void refresh(); }).on('postgres_changes', { event: '*', schema: 'public', table: 'devices', filter: 'user_id=eq.' + user.id }, () => { void refresh(); }).subscribe(state => { setStatus(state === 'SUBSCRIBED' ? 'Connected' : state === 'CHANNEL_ERROR' ? 'Reconnecting' : 'Connecting'); });
    const interval = setInterval(() => { void refresh(); if (stored && !paused && document.visibilityState === 'visible') void client.rpc('heartbeat', { target_device: stored }); }, 30000);
    return () => { clearInterval(interval); void client.removeChannel(channel); };
  }, [user, refresh, paused, deviceId]);
  useEffect(() => {
    const device = devices.find(item => item.id === deviceId);
    confirmed.current = Boolean(device && !device.revoked);
    if (device?.revoked) setStatus('Device access revoked');
    if (!confirmed.current || paused || !backend) return;
    const incoming = clips.find(item => item.device_id !== deviceId && !item.acknowledged_at);
    if (incoming && document.visibilityState === 'visible') void backend.rpc('acknowledge_clip', { clip_id: incoming.id, target_device: deviceId }).then(({ error }) => { if (!error) { notify('New clip received. Choose Copy to use it on this device.'); setPulse(true); setTimeout(() => setPulse(false), 1000); } });
  }, [clips, devices, deviceId, paused, notify]);
  async function send(text: string) {
    const parsed = clipboardSchema.safeParse({ text });
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);
    if (!backend || !user) throw new Error('Sign in to a configured workspace to send a clip.');
    if (!confirmed.current) throw new Error('Authorize this browser in Devices first.');
    if (paused) throw new Error('Resume synchronization before sending.');
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
    if (!enabled) { const { error } = await backend.from('clips').delete().eq('user_id', user.id); if (error) throw error; }
    const { error } = await backend.auth.updateUser({ data: { history: enabled, retention: days } });
    if (error) throw error; setHistory(enabled); setRetention(days); await refresh(); notify('Privacy preferences saved.');
  }
  async function pairing(action: 'create' | 'join' | 'confirm', code?: string, name?: string, platform?: string) {
    if (!backend || !user) throw new Error('Sign in to a configured workspace to pair devices.');
    const { data, error } = await backend.rpc(action === 'create' ? 'create_pairing' : action === 'join' ? 'join_pairing' : 'confirm_pairing', action === 'create' ? { device_name: name, device_platform: platform } : { pairing_code: code });
    if (error) throw error;
    if (action !== 'confirm' && data.device_id) { localStorage.setItem('clipsync-device-' + user.id, data.device_id); setDeviceId(data.device_id); }
    await refresh(); return data;
  }
  return { user, clips, devices, loading, status: paused ? 'Sync paused' : status, notice, notify, paused, setPaused, history, retention, deviceId, pulse, events, send, mutate, preferences, pairing, refresh, configured: Boolean(backend) };
}
