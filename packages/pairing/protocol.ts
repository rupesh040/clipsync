import { z } from 'zod';
import { signalSchema } from '../transport/signals';

export const secretSchema=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const pairingSchema=z.object({version:z.literal(1),service:z.literal('clipsync-pair'),serviceId:z.string().min(1).max(80),sessionId:z.uuid(),secret:secretSchema,expiresAt:z.number().int().positive(),deviceName:z.string().min(1).max(60)}).strict();
export type PairingQr=z.infer<typeof pairingSchema>;
export const credentialsSchema=z.object({sessionId:z.uuid(),token:secretSchema,deviceId:z.uuid(),expiresAt:z.number().int().positive()}).strict();
export type Credentials=z.infer<typeof credentialsSchema>;
export const sessionSchema=z.object({sessionId:z.uuid(),status:z.enum(['waiting','pending','approved','expired','revoked']),deviceId:z.uuid(),peerId:z.uuid().optional(),deviceName:z.string().max(60),peerName:z.string().max(60).optional(),verification:z.string().optional(),expiresAt:z.number(),role:z.enum(['host','phone'])}).strict();
export type PairSession=z.infer<typeof sessionSchema>;
const auth=z.object({sessionId:z.uuid(),token:secretSchema}).strict();
const base={id:z.uuid()};
const name=z.string().trim().min(1).max(60);
const proof=z.union([z.object({sessionId:z.uuid(),secret:secretSchema}).strict(),z.object({code:z.string().regex(/^[A-F0-9]{12}$/)}).strict()]);
export const requestSchema=z.discriminatedUnion('op',[
 z.object({...base,op:z.literal('create'),name}).strict(),
 z.object({...base,op:z.literal('inspect'),proof}).strict(),
 z.object({...base,op:z.literal('join'),proof,name}).strict(),
 ...(['attach','confirm','revoke','authorize','configuration'] as const).map(op=>z.object({...base,op:z.literal(op),auth}).strict()),
 z.object({...base,op:z.literal('signal'),auth,signal:signalSchema.pick({kind:true,payload:true,session_id:true}).strict()}).strict(),
]);
export type PairRequest=z.infer<typeof requestSchema>;
export function parsePairingQr(raw:string,serviceId:string,now=Date.now()){
 if(raw.length>2048)throw new Error('QR code is too large.');
 const qr=pairingSchema.parse(JSON.parse(raw));
 if(qr.serviceId!==serviceId)throw new Error('This code belongs to a different signaling service.');
 if(qr.expiresAt<=now||qr.expiresAt>now+330_000)throw new Error('Pairing code expired or has an invalid expiry.');
 return qr;
}
export function signalingUrl(value:string|undefined){
 if(!value)return '';
 const url=new URL(value);
 if(url.username||url.password||url.hash||url.search||!/^\/(?:functions\/v1\/[a-z0-9-]+\/)?signal$/.test(url.pathname))throw new Error('Use the configured /signal WebSocket endpoint without credentials or query parameters.');
 if(url.protocol!=='wss:'&&!(url.protocol==='ws:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Signaling requires WSS; unencrypted WS is allowed only on localhost.');
 return url.href;
}
