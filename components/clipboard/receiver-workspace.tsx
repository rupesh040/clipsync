'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Clipboard, Copy, Link2, Pause, Play, RefreshCw, Send, ShieldCheck, Unplug } from 'lucide-react';
import type { ClipsyncState } from '@/hooks/use-clipsync';
type ReceiverSync=Pick<ClipsyncState,'latest'|'devices'|'deviceId'|'peerId'|'history'|'clips'|'status'|'connectionState'|'connectionDetail'|'lastSync'|'relayConfigured'|'paused'|'setPaused'|'direction'|'storageError'|'selectPeer'|'reconnect'|'disconnect'|'syncClipboard'|'send'|'copyText'>&{mutate:(operation:'clear')=>Promise<void>};

export function ReceiverWorkspace({sync}:{sync:ReceiverSync}) {
  const [copied,setCopied]=useState(false);
  const [error,setError]=useState('');
  const [manual,setManual]=useState('');
  const [busy,setBusy]=useState(false);
  const textPanel=useRef<HTMLPreElement>(null);
  async function run(action:()=>Promise<unknown>) {setBusy(true);setError('');try{await action();}catch(failure){setError(failure instanceof Error?failure.message:'The operation could not complete.');}finally{setBusy(false);}}
  async function copy() {if(!sync.latest)return;await run(async()=>{await sync.copyText(sync.latest!.content);setCopied(true);setTimeout(()=>setCopied(false),1600);});}
  function selectText(){if(!textPanel.current)return;const range=document.createRange();range.selectNodeContents(textPanel.current);const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);textPanel.current.focus();}
  const targets=sync.devices.filter(device=>!device.revoked&&device.id!==sync.deviceId);
  return <>
    <div className="p2p-workspace">
      <section className="panel received-panel" aria-labelledby="received-title">
        <div className="panel-heading"><div><Clipboard size={17}/><h2 id="received-title">Your latest clipboard</h2></div><span className="micro">WEBRTC · {sync.history?'LOCAL HISTORY ON':'MEMORY ONLY'}</span></div>
        {sync.latest?<><div className="received-meta"><span>{sync.latest.source}</span><time dateTime={sync.latest.created_at}>{new Date(sync.latest.created_at).toLocaleString()}</time></div><pre ref={textPanel} className="received-text" tabIndex={0} aria-label="Received clipboard text">{sync.latest.content}</pre><div className="received-actions"><button className="button green" onClick={()=>void copy()} disabled={busy}>{copied?<Check size={16}/>:<Copy size={16}/>} {copied?'Copied':'Copy complete text'}</button><button className="button" onClick={selectText}>Select text</button></div></>:<div className="empty received-empty"><Clipboard size={32} strokeWidth={1}/><h3>Copy on your PC. See it here.</h3><p>Connect your phone to the PC extension. Detected copies arrive here automatically while both clients are open and connected.</p><Link className="text-link" href="/devices/">Pair your devices <ArrowRight size={15}/></Link></div>}
        {error&&<p className="receiver-error" role="alert">{error} {sync.latest&&<button className="text-link" onClick={selectText}>Select the text and copy manually.</button>}</p>}
        {sync.storageError&&<p className="receiver-error" role="alert">{sync.storageError}</p>}
        <div className="panel-footer"><span><ShieldCheck size={14}/> No clipboard payload is sent to Supabase.</span>{sync.history&&<button className="text-link" onClick={()=>void run(()=>sync.mutate('clear'))}>Clear local history</button>}</div>
      </section>
      <section className="panel peer-panel"><div className="panel-heading"><div><Link2 size={17}/><h2>Your private connection</h2></div></div><div className="peer-controls"><label htmlFor="paired-peer">Paired device</label><select id="paired-peer" value={sync.peerId} onChange={event=>sync.selectPeer(event.target.value)} disabled={!targets.length}><option value="">Select a paired device</option>{targets.map(device=><option value={device.id} key={device.id}>{device.name}</option>)}</select><div className={'peer-state state-'+sync.connectionState} role="status"><span className="green-dot"/>{sync.status}</div><p>{sync.connectionState==='unpaired'?'Pair both devices to establish an authorized connection.':sync.connectionDetail}</p><small>Last successful message: {sync.lastSync?new Date(sync.lastSync).toLocaleTimeString():'None yet'}</small>{sync.relayConfigured===false&&<p className="relay-warning">TURN is not configured. Connections may fail on restrictive networks.</p>}<div className="button-row"><button className="button" onClick={sync.reconnect} disabled={!sync.peerId||sync.paused}><RefreshCw size={15}/> Reconnect</button><button className="button" onClick={()=>sync.setPaused(!sync.paused)}>{sync.paused?<Play size={15}/>:<Pause size={15}/>} {sync.paused?'Resume':'Pause'}</button><button className="icon-button" aria-label="Disconnect peer" onClick={()=>void run(async()=>{await sync.disconnect();})}><Unplug size={18}/></button></div><button className="button green full-width" disabled={busy||!sync.peerId||sync.paused||sync.direction==='receive'} onClick={()=>void run(sync.syncClipboard)}><Send size={15}/> Sync Clipboard to PC</button><p className="small-note">Copies inside this app sync automatically. System clipboard reads require a tap. Offline updates queue locally; suspended apps resume when reopened.</p></div></section>
    </div>
    <details className="panel manual-fallback"><summary>Send text manually · optional fallback</summary><form onSubmit={event=>{event.preventDefault();void run(async()=>{await sync.send(manual);setManual('');});}}><label htmlFor="fallback-text">Text to send</label><textarea id="fallback-text" value={manual} onChange={event=>setManual(event.target.value)} maxLength={20_000}/><button className="button" disabled={busy||!sync.peerId||sync.paused||sync.direction==='receive'}>Send over WebRTC <ArrowRight size={15}/></button></form></details>
    {sync.history&&<section className="panel local-recent"><div className="panel-heading"><h2>Recent on this browser</h2><Link className="text-link" href="/history/">View local history ↗</Link></div>{sync.clips.slice(0,3).map(clip=><article key={clip.id}><span>{clip.source}</span><pre>{clip.content.slice(0,140)}</pre></article>)}</section>}
  </>;
}
