import { z } from 'zod';
export const clipboardSchema = z.object({ text: z.string().trim().min(1, 'Enter something to send.').max(20000, 'Keep each clip under 20,000 characters.') });
export function contentType(text: string) { if (/^https?:\/\/\S+$/.test(text)) return 'URL'; if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return 'Email'; if (/[{};]|=>|\b(const|function|import|def)\b/.test(text)) return 'Code'; return 'Text'; }
export async function copyText(text: string) { if (!window.isSecureContext || !navigator.clipboard?.writeText) throw new Error('Clipboard access requires HTTPS and a supported browser. Select and copy the text manually.'); await navigator.clipboard.writeText(text); }
export type Clip = { id: string; content: string; source: string; created_at: string; pinned: boolean; expires_at?: string; device_id?: string; acknowledged_at?: string | null; clip_receipts?: { device_id: string }[] };
export type Device = { id: string; name: string; platform: string; last_seen: string; revoked: boolean; last_sync: string | null };
