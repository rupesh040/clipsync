'use client';
import { createContext, useContext } from 'react';
import { useClipsyncController, type ClipsyncState } from '@/hooks/use-clipsync';
const SyncContext=createContext<ClipsyncState|null>(null);
export function SyncProvider({children}:{children:React.ReactNode}) {const sync=useClipsyncController();return <SyncContext value={sync}>{children}</SyncContext>;}
export function useClipsync() {const sync=useContext(SyncContext);if(!sync)throw new Error('Clipsync provider is missing.');return sync;}
