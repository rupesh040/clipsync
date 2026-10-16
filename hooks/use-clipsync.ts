'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { User } from '@supabase/supabase-js';
import { backend, publicConfiguration } from '@/lib/supabase';
import { localClipboardStore, type SyncDirection } from '@/lib/local-clipboard';
import { copyText, type Device } from '@/lib/clipboard';
import { useSessionPause } from './use-browser-state';
import { ClipboardPeer } from '@/packages/transport/peer';
import { SupabaseSignaling } from '@/packages/transport/supabase-signaling';
import { fetchRtcConfiguration } from '@/packages/transport/configuration';
import type { ConnectionState } from '@/packages/protocol';

export function useClipsyncController() {
  const [user,setUser] = useState<User | null>(null);
  const [devices,setDevices] = useState<Device[]>([]);
  const [deviceId,setDeviceId] = useState('');
  const [selectedPeer,setSelectedPeer] = useState('');
  const [loading,setLoading] = useState(Boolean(backend));
  const [notice,setNotice] = useState('');
  const [paused,setPaused] = useSessionPause();
  const [disconnected,setDisconnected] = useState(false);
  const [connectionRevision,setConnectionRevision] = useState(0);
  const [connectionState,setConnectionState] = useState<ConnectionState>('unpaired');
  const [pairingUntil,setPairingUntil] = useState(0);
  const [connectionDetail,setConnectionDetail] = useState('Pair a second device to begin.');
  const [relayConfigured,setRelayConfigured] = useState<boolean | null>(null);
  const [lastSync,setLastSync] = useState<number | null>(null);
  const [pulse,setPulse] = useState(false);
  const [events,setEvents] = useState<string[]>([]);
  const manager = useRef<ClipboardPeer | null>(null);
  const epoch = useRef(0);
  const store = useMemo(() => localClipboardStore(user?.id || 'guest'),[user?.id]);
  const local = useSyncExternalStore(store.subscribe,store.getSnapshot,store.getServerSnapshot);
  const notify = useCallback((message: string) => { setNotice(message); window.dispatchEvent(new CustomEvent('clipsync-notice',{detail:message})); },[]);
  useEffect(() => { const timer=setTimeout(() => setNotice(''),6000); return () => clearTimeout(timer); },[notice]);
  useEffect(() => { if(!pairingUntil) return;const timer=setTimeout(()=>setPairingUntil(0),Math.max(0,pairingUntil-Date.now()));return ()=>clearTimeout(timer); },[pairingUntil]);

  const refresh = useCallback(async () => {
    if (!backend) return;
    const current = epoch.current;
    const {data,error} = await backend.from('devices').select('*').order('last_seen',{ascending:false});
    if (current!==epoch.current) return;
    if (error) notify('Unable to load device authorization. Check your connection and sign-in.');
    else setDevices(data || []);
    setLoading(false);
  },[notify]);

  useEffect(() => {
    if (!backend) return;
    const client=backend;
    let active=true;
    const restore=(identity: User | null) => {
      epoch.current+=1; setUser(identity);
      if (identity) { setDeviceId(localStorage.getItem('clipsync-device-'+identity.id)||''); setSelectedPeer(localStorage.getItem('clipsync-peer-'+identity.id)||''); }
      else { setDeviceId('');setSelectedPeer('');setDevices([]);setLoading(false);setPairingUntil(0); }
    };
    void client.auth.getUser().then(({data}) => { if (active) restore(data.user); }).catch(() => { if (active) { restore(null); notify('Authentication is unavailable. Reconnect and sign in.'); } });
    const {data:listener}=client.auth.onAuthStateChange((_event,session) => { if (active) restore(session?.user || null); });
    return () => {active=false;listener.subscription.unsubscribe();};
  },[notify]);

  useEffect(() => () => store.clearMemory(),[store]);
  useEffect(() => {
    if (!backend || !user) return;
    const client=backend;
    const channel=client.channel('device-metadata-'+user.id).on('postgres_changes',{event:'*',schema:'public',table:'devices',filter:'user_id=eq.'+user.id},() => {void refresh();}).subscribe(status => { if(status==='SUBSCRIBED') void refresh(); });
    const visible=() => {if(document.visibilityState==='visible') {void refresh();setConnectionRevision(value => value+1);}};
    const online=() => {void refresh();setConnectionRevision(value => value+1);};
    const offline=() => {void manager.current?.stop();setConnectionState('disconnected');setConnectionDetail('This device is offline. Reconnect when networking returns.');};
    document.addEventListener('visibilitychange',visible);window.addEventListener('online',online);window.addEventListener('offline',offline);
    const timer=setInterval(() => {if(document.visibilityState==='visible') {void refresh();if(deviceId&&!paused) void client.rpc('heartbeat',{target_device:deviceId});}},30_000);
    return () => {epoch.current+=1;clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('online',online);window.removeEventListener('offline',offline);void client.removeChannel(channel);};
  },[user,deviceId,paused,refresh]);

  const currentAuthorized=devices.some(device => device.id===deviceId&&!device.revoked);
  const remoteId=selectedPeer || devices.find(device => device.id!==deviceId&&!device.revoked)?.id || '';
  const remote=devices.find(device => device.id===remoteId&&!device.revoked);
  const remoteName=remote?.name || 'Paired device';
  const remoteAuthorized=Boolean(remote);
  const userId=user?.id;
  useEffect(() => {
    if(!backend || !userId || !currentAuthorized || !remoteAuthorized || !remoteId || paused || disconnected) return;
    const peer=new ClipboardPeer({local:deviceId,remote:remoteId,signaling:new SupabaseSignaling(backend,deviceId,remoteId),configuration:() => fetchRtcConfiguration(backend!,deviceId,location.origin,setRelayConfigured),onState:(state,detail) => {setConnectionState(state);setConnectionDetail(detail);},onClipboard:message => {
      if(local.direction==='send') throw new Error('Receiving is disabled on this device.');
      store.receive(message,remoteName);setLastSync(Date.now());setPulse(true);setTimeout(() => setPulse(false),700);setEvents(previous => ['Clipboard received over WebRTC',...previous].slice(0,30));
    },onReceipt:timestamp => {setLastSync(timestamp);setEvents(previous => ['Peer acknowledged a clipboard message',...previous].slice(0,30));}});
    manager.current=peer;void peer.start();
    return () => {if(manager.current===peer) manager.current=null;void peer.stop(false);};
  },[userId,deviceId,remoteId,currentAuthorized,remoteAuthorized,remoteName,paused,disconnected,store,local.direction,connectionRevision]);

  async function send(text: string, origin: 'manual'|'user-read'='manual') {
    if(local.direction==='receive') throw new Error('This device is set to receive only.');
    if(!manager.current || paused || disconnected) throw new Error('Connect an authorized peer first. Nothing was uploaded or queued.');
    await manager.current.send(text,origin);notify('The paired device acknowledged receipt.');
  }
  async function syncClipboard() {
    if(!window.isSecureContext || !navigator.clipboard?.readText) throw new Error('Clipboard reading is unavailable here. Use a supported HTTPS browser; incoming text still works.');
    let text: string;
    try {text=await navigator.clipboard.readText();} catch {throw new Error('Clipboard reading was denied. Incoming text is unaffected. Change site permissions or use manual sending.');}
    await send(text,'user-read');
  }
  async function mutate(operation:'pin'|'delete'|'clear'|'revoke'|'rename',id?:string,value?:string|boolean) {
    if(['pin','delete','clear'].includes(operation)) {store.mutate(operation as 'pin'|'delete'|'clear',id,typeof value==='boolean'?value:undefined);return;}
    if(!backend || !user) throw new Error('Sign in first.');
    const {error}=await backend.from('devices').update(operation==='revoke'?{revoked:true}:{name:String(value)}).eq('id',id!);
    if(error) throw new Error(error.message);await refresh();
  }
  async function preferences(enabled:boolean,days:number) {store.preferences(enabled,days);notify('Local privacy preferences saved. Clipboard text is not uploaded.');}
  function direction(value:SyncDirection) {store.preferences(local.enabled,local.days,value);}
  async function clearLegacyHistory() {if(!backend||!user) throw new Error('Sign in first.');const {error}=await backend.from('clips').delete().eq('user_id',user.id);if(error)throw new Error(error.message);notify('Legacy cloud clipboard data deleted.');}
  async function pairing(action:'create'|'join'|'confirm',code?:string,name?:string,platform?:string,joiningDevice?:string) {
    if(!backend||!user) throw new Error('Sign in to a configured workspace to pair devices.');
    const {data,error}=await backend.rpc(action==='create'?'create_pairing':action==='join'?'join_pairing':'confirm_pairing',action==='create'?{device_name:name,device_platform:platform}:action==='join'?{pairing_code:code,joining_device:joiningDevice||localStorage.getItem('clipsync-device-'+user.id)}:{pairing_code:code});
    if(error) throw new Error(error.message);
    setPairingUntil(action==='confirm'?0:Date.parse(data.expires_at||'')||Date.now()+300_000);
    if(action!=='confirm'&&data.device_id) {localStorage.setItem('clipsync-device-'+user.id,data.device_id);setDeviceId(data.device_id);}
    await refresh();return data;
  }
  function selectPeer(value:string) {setSelectedPeer(value);if(user) localStorage.setItem('clipsync-peer-'+user.id,value);}
  function reconnect() {setDisconnected(false);setConnectionRevision(value => value+1);void refresh();}
  const state:ConnectionState=!currentAuthorized||!remoteAuthorized?pairingUntil?'pairing':'unpaired':paused||disconnected?'disconnected':connectionState;
  const status=!backend?(publicConfiguration.error?'Configuration error':'Waiting for setup'):!user?'Sign in required':paused?'Sync paused':state[0].toUpperCase()+state.slice(1);
  return {user,devices,deviceId,loading,configured:Boolean(backend),status,notice,notify,paused,setPaused,history:local.enabled,retention:local.days,clips:local.items,latest:local.latest,storageError:local.storageError,pulse,events,send,mutate,preferences,pairing,cancelPairingState:()=>setPairingUntil(0),refresh,peerId:remoteId,selectPeer,connectionState:state,connectionDetail:state==='pairing'?'Waiting for explicit confirmation on the initiating device.':connectionDetail,lastSync,relayConfigured,reconnect,disconnect:() => setDisconnected(true),syncClipboard,direction:local.direction,setDirection:direction,clearLegacyHistory,copyText};
}
export type ClipsyncState=ReturnType<typeof useClipsyncController>;
