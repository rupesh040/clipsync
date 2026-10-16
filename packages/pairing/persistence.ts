import {credentialsSchema,sessionSchema} from './protocol';
import {z} from 'zod';
import type {RecoveryStorage} from '../transport/ledger';
export const resumeSchema=z.object({endpoint:z.string(),serviceId:z.string(),credentials:credentialsSchema,session:sessionSchema}).strict();
export function tabStorage(key:string):RecoveryStorage{
 return{
  load:async()=>{try{for(const name of Object.keys(sessionStorage)){if(name.startsWith('clipsync-outbox-')||name.startsWith('clipsync-account-outbox-')){try{const saved=JSON.parse(sessionStorage.getItem(name)||'null');if(!saved?.expiresAt||saved.expiresAt<=Date.now())sessionStorage.removeItem(name);}catch{sessionStorage.removeItem(name);}}}return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}},
  save:async value=>{if(value===null)sessionStorage.removeItem(key);else sessionStorage.setItem(key,JSON.stringify(value));},
 };
}
