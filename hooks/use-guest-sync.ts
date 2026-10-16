'use client';
import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {GuestClient,shouldRecoverSession} from '@/packages/pairing/client';
import {GuestSignaling} from '@/packages/transport/guest-signaling';
import {ClipboardPeer} from '@/packages/transport/peer';
import type {ConnectionState} from '@/packages/protocol';
import {localClipboardStore,type SyncDirection} from '@/lib/local-clipboard';
import {copyText,type Device} from '@/lib/clipboard';
import {deployedSignaling} from '@/lib/deployment';

export function useGuestSync(){
 const [client]=useState(()=>new GuestClient(process.env.NEXT_PUBLIC_SIGNALING_URL||deployedSignaling,process.env.NEXT_PUBLIC_SIGNALING_SERVICE_ID||'clipsync'));
 const pair=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getServerSnapshot);
 const [store]=useState(()=>localClipboardStore('login-free'));
 const local=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getServerSnapshot);
 const [paused,setPaused]=useState(false),[state,setState]=useState<ConnectionState>('unpaired'),[detail,setDetail]=useState('Pair using a temporary QR code. No account needed.'),[revision,setRevision]=useState(0),[lastSync,setLastSync]=useState<number|null>(null),[relayConfigured,setRelay]=useState<boolean|null>(null),[notice,notify]=useState('');
 const manager=useRef<ClipboardPeer|null>(null);
 const session=pair.session,deviceId=session?.deviceId||'',peerId=session?.peerId||'',peerName=session?.peerName||'Paired device';
 const sessionStatus=session?.status,sessionId=session?.sessionId;
 useEffect(()=>()=>{client.close();store.clearMemory();},[client,store]);
 useEffect(()=>{
  if(sessionStatus!=='approved'||!peerId||paused)return;
  const signaling=new GuestSignaling(client);
  const peer=new ClipboardPeer({local:deviceId,remote:peerId,signaling,configuration:()=>signaling.configuration(setRelay),onState:(value,message)=>{setState(value);setDetail(message);},onClipboard:message=>{if(local.direction==='send')throw new Error('Receiving is disabled.');store.receive(message,peerName);setLastSync(Date.now());},onReceipt:time=>setLastSync(time)});
  manager.current=peer;void peer.start();return()=>{if(manager.current===peer)manager.current=null;void peer.stop(false);};
 },[client,store,sessionId,sessionStatus,deviceId,peerId,peerName,paused,revision,local.direction]);
 useEffect(()=>{const online=()=>{if(shouldRecoverSession(client.getSnapshot()))void client.reconnect().catch(()=>{});};const visible=()=>{if(document.visibilityState==='visible')online();};window.addEventListener('online',online);document.addEventListener('visibilitychange',visible);return()=>{window.removeEventListener('online',online);document.removeEventListener('visibilitychange',visible);};},[client]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>notify(''),6000);return()=>clearTimeout(timer);},[notice]);
 const send=useCallback(async(text:string,origin:'manual'|'user-read'='manual')=>{if(paused||local.direction==='receive'||!manager.current)throw new Error('Connect a peer and enable sending first. Nothing was queued.');await manager.current.send(text,origin);notify('Paired device acknowledged receipt.');},[paused,local.direction]);
 async function syncClipboard(){if(!navigator.clipboard?.readText)throw new Error('Clipboard reading is unsupported. Incoming text is unaffected.');let text:string;try{text=await navigator.clipboard.readText();}catch{throw new Error('Clipboard reading was denied. Incoming text still works.');}await send(text,'user-read');}
 async function disconnect(){await manager.current?.stop();try{await client.revoke();notify('Session revoked. Pair another device whenever you’re ready.');}catch{notify('Disconnected locally. Server revocation is unconfirmed; retry when online or let the session expire.');throw new Error('Unable to confirm remote revocation. Reconnect and retry.');}finally{setState('disconnected');store.clearMemory();}}
 const connectionState:ConnectionState=!session?'unpaired':session.status==='waiting'||session.status==='pending'?'pairing':session.status!=='approved'?'disconnected':paused?'disconnected':!pair.online?'reconnecting':state;
 const devices:Device[]=session?[{id:deviceId,name:session.deviceName,platform:session.role==='host'?'PC browser':'Phone PWA',last_seen:new Date(0).toISOString(),revoked:false,last_sync:null},...(peerId?[{id:peerId,name:peerName,platform:'Temporary peer',last_seen:new Date(0).toISOString(),revoked:session.status==='revoked',last_sync:null}]:[])]:[];
 return{client,pair,session,devices,deviceId,peerId,latest:local.latest,clips:local.items,storageError:local.storageError,history:local.enabled,retention:local.days,direction:local.direction,paused,setPaused,notice,notify,lastSync,relayConfigured,connectionState,connectionDetail:pair.error||detail,status:paused?'Sync paused':connectionState[0].toUpperCase()+connectionState.slice(1),copyText,send,syncClipboard,disconnect,reconnect:()=>{void client.reconnect().then(()=>setRevision(value=>value+1)).catch(error=>notify(error.message));},selectPeer:()=>{},mutate:async(operation:'pin'|'delete'|'clear',id?:string,value?:string|boolean)=>{store.mutate(operation,id,typeof value==='boolean'?value:undefined);},preferences:async(enabled:boolean,days:number)=>{store.preferences(enabled,days);},setDirection:(direction:SyncDirection)=>store.preferences(local.enabled,local.days,direction)};
}
export type GuestSync=ReturnType<typeof useGuestSync>;
