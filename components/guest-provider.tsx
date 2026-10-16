'use client';
import {createContext,useContext} from 'react';
import {useGuestSync,type GuestSync} from '@/hooks/use-guest-sync';
const Context=createContext<GuestSync|null>(null);
export function GuestProvider({children}:{children:React.ReactNode}){const sync=useGuestSync();return <Context value={sync}>{children}</Context>;}
export function useGuest(){const sync=useContext(Context);if(!sync)throw new Error('Guest provider missing.');return sync;}
