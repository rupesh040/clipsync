'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Brand } from './brand';
import { backend, publicConfiguration } from '@/lib/supabase';
import { authFailureMessage } from '@/lib/auth-errors';

export function AuthForm() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (!backend) {
      setMessage(publicConfiguration.error || 'Supabase is not configured yet. See the setup guide.');
      return;
    }
    if (!navigator.onLine) { setMessage('Reconnect to the internet before signing in.'); return; }
    setBusy(true);
    try {
      const { error } = await backend.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: new URL('/auth/callback/', location.origin).href } });
      if (error) throw error;
      setMessage('Check your inbox. Open the secure link in this same browser to finish signing in.');
    } catch (error) {
      setMessage(authFailureMessage(error));
    } finally { setBusy(false); }
  }

  async function verifyCode(event:React.FormEvent){
    event.preventDefault();if(!backend){setMessage('Configure Supabase first.');return;}
    setBusy(true);try{const {error}=await backend.auth.verifyOtp({email:email.trim(),token:code.trim(),type:'email'});if(error)throw error;location.assign(new URL('/dashboard/',location.origin).href);}catch(error){setMessage(authFailureMessage(error));}finally{setBusy(false);}
  }

  return <main className="auth-page"><Brand/><div className="auth-panel">
    <div className="eyebrow">A SMALL BRIDGE BETWEEN YOUR SCREENS</div>
    <h1>Your flow<br/>starts here.</h1>
    <p>Sign in or create an account with a secure email link. No password to remember.</p>
    <form onSubmit={signIn}>
      <label htmlFor="email">Email address</label>
      <input id="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com"/>
      <button className="button green full-width" disabled={busy}>{busy ? 'Sending…' : 'Send sign-in link'} <ArrowRight size={16}/></button>
    </form>
    <details><summary>Use an email code in this browser or installed PWA</summary><p className="small-note">Request the email above, then enter its numeric code here. This avoids opening a different browser. Your Supabase email template must include the code.</p><form onSubmit={verifyCode}><label htmlFor="email-code">Email code</label><input id="email-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required value={code} onChange={event=>setCode(event.target.value)}/><button className="button full-width" disabled={busy||!email}>Verify email code</button></form></details>
    <p role="status">{message}</p>
    <p className="small-note"><ShieldCheck size={14}/> Open the email link in the browser that requested it. Sign in separately on each device.</p>
    <Link href="/help/" className="text-link">Setup & documentation ↗</Link>
  </div><Link href="/dashboard/" className="text-link">Explore the empty workspace →</Link></main>;
}
