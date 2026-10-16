'use client';
import { useClock } from '@/hooks/use-browser-state';
import { ArrowLeft, ArrowRight, Laptop, Smartphone, Plus } from 'lucide-react';
import Link from 'next/link';
import type { Device } from '@/lib/clipboard';
export function DeviceDiagram({ devices = [], current = '', pulse = false, preview = false }: { devices?: Device[]; current?: string; pulse?: boolean; preview?: boolean }) {
  const now = useClock();
  const active = devices.filter(device => !device.revoked);
  const desktop = active.find(device => device.id === current) || active[0];
  const phone = active.find(device => device.id !== desktop?.id);
  return <div className={'device-diagram ' + (pulse ? 'sync-pulse' : '')}>
    <div className="device-node"><div className="device-picture"><Laptop strokeWidth={1} size={76}/><span className="device-signal"/></div><strong>{preview ? 'Your computer' : desktop?.name || 'This browser'}</strong><span>{preview ? 'COPY HERE' : desktop ? 'Current device' : 'Not authorized yet'}</span><small>{preview ? 'Desktop web' : desktop ? (now - Date.parse(desktop.last_seen) < 90000 ? '● Online' : '○ Offline') : 'Pair to get started'}</small></div>
    <div className="connection"><span className="micro">{preview ? 'ONE SIMPLE CONNECTION' : 'YOUR PRIVATE CONNECTION'}</span><div className="connection-lines"><ArrowRight size={19}/><i/><ArrowLeft size={19}/></div><span className="connection-label">{preview ? 'Text moves both ways' : pulse ? 'Receipt confirmed' : phone ? 'Ready for manual sending' : 'Waiting for another device'}</span></div>
    <div className={'device-node ' + (!phone && !preview ? 'unpaired' : '')}><div className="device-picture"><Smartphone strokeWidth={1} size={65}/>{!phone && !preview && <Plus className="device-plus" size={17}/>}</div><strong>{preview ? 'Your phone' : phone?.name || 'Your next device'}</strong><span>{preview ? 'PASTE THERE' : phone ? phone.platform : 'A little less back and forth'}</span><small>{preview ? 'Mobile web' : phone ? (now - Date.parse(phone.last_seen) < 90000 ? '● Online' : '○ Offline') : <Link href="/devices/">Connect a device ↗</Link>}</small></div>
  </div>;
}
