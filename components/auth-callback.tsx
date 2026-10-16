'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { backend } from '@/lib/supabase';
import { Brand } from './brand';

export function AuthCallback() {
  const started = useRef(false);
  const [message, setMessage] = useState('Verifying your sign-in link…');
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = new URL(location.href).searchParams.get('code');
    window.history.replaceState(null, '', '/auth/callback/');
    const client = backend;
    void (async () => {
      try {
        if (!client || !code) throw new Error();
        const { error } = await client.auth.exchangeCodeForSession(code);
        if (error) throw error;
        const { data, error: identityError } = await client.auth.getUser();
        if (identityError || !data.user) throw new Error();
        location.replace('/dashboard/');
      } catch {
        setMessage('This link has expired or was opened in another browser. Request a fresh link here and open it in this browser.');
      }
    })();
  }, []);
  return <main className="auth-page"><Brand/><div className="auth-panel"><h1>One moment.</h1><p role="status">{message}</p><Link className="button" href="/login/">Back to sign in</Link></div></main>;
}
