'use client';
import Link from 'next/link';
import type { ClipsyncState } from '@/hooks/use-clipsync';
import type { SyncDirection } from '@/lib/local-clipboard';

export function SyncPreferences({sync}:{sync:ClipsyncState}) {
  return <section className="panel settings-section p2p-settings"><h2>Peer-to-peer delivery</h2><div className="setting-row"><div><strong>Synchronization direction</strong><p>PC-to-phone receiving is automatic while connected. Phone-to-PC reads require Sync Clipboard.</p></div><select aria-label="Synchronization direction" value={sync.direction} onChange={event=>{try{sync.setDirection(event.target.value as SyncDirection);}catch(error){sync.notify(error instanceof Error?error.message:'Unable to save direction.');}}}><option value="both">Both directions</option><option value="receive">Receive only</option><option value="send">Send only</option></select></div><p className="small-note">New clipboard text never goes to Postgres. Opt-in local history is plaintext browser storage on this device. Avoid enabling it for secrets or on shared devices.</p><div className="button-row"><Link className="button" href="/help/#extension">PC extension setup ↗</Link><button className="button danger" onClick={()=>{if(window.confirm('Delete any legacy cloud clipboard content from the earlier version?'))void sync.clearLegacyHistory().catch(()=>sync.notify('Unable to delete legacy data. Sign in and retry.'));}}>Delete legacy cloud history</button></div></section>;
}
