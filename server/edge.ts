import {requestSchema} from '../packages/pairing/protocol';
import {signalSchema} from '../packages/transport/signals';
import identity from '../extension/identity.json';
declare const Deno:{env:{get:(key:string)=>string|undefined};serve:(handler:(request:Request)=>Response|Promise<Response>)=>void;upgradeWebSocket:(request:Request,options:{idleTimeout:number})=>{socket:WebSocket;response:Response}};
const allowedOrigins=new Set(['https://clipsync-orcin.vercel.app','http://localhost:3000','http://localhost:3011','chrome-extension://'+identity.id]);
const databaseUrl=Deno.env.get('SUPABASE_URL'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const active=new Set<WebSocket>();
async function rpc(message:Record<string,unknown>,connection:string,ip:string){
 const response=await fetch(databaseUrl+'/rest/v1/rpc/guest_pair_operation',{method:'POST',headers:{apikey:serviceKey!,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify({message,connection_id:connection,ip_digest:ip}),signal:AbortSignal.timeout(10_000)});
 const result=await response.json();
 if(!response.ok)throw new Error(typeof result.message==='string'?result.message:'Signaling database unavailable.');
 return result;
}
async function ice(sessionId:string,deviceId:string){
 const stun=(Deno.env.get('STUN_URLS')||'stun:stun.l.google.com:19302').split(',').filter(value=>/^stuns?:[^\s]+$/.test(value));
 const iceServers:RTCIceServer[]=stun.length?[{urls:stun}]:[],turn=(Deno.env.get('TURN_URLS')||'').split(',').filter(value=>/^turns?:[^\s@]+$/.test(value)),secret=Deno.env.get('TURN_SHARED_SECRET');
 let expiresAt:number|null=null;
 if(turn.length&&secret){expiresAt=Math.floor(Date.now()/1000)+Math.max(60,Math.min(3600,Number(Deno.env.get('TURN_TTL_SECONDS'))||600));const username=expiresAt+':'+sessionId+':'+deviceId;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-1'},false,['sign']);const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(username)));const credential=btoa(String.fromCharCode(...bytes));iceServers.push({urls:turn,username,credential});}
 return{iceServers,relayConfigured:expiresAt!==null,expiresAt};
}
Deno.serve(async request=>{
 const path=new URL(request.url).pathname;
 if(path.endsWith('/health'))return Response.json({status:'ready',service:'clipsync',version:1},{headers:{'Cache-Control':'no-store'}});
 if(!path.endsWith('/signal')||request.headers.get('upgrade')?.toLowerCase()!=='websocket'||!allowedOrigins.has(request.headers.get('origin')||''))return new Response('Origin or protocol rejected',{status:403});
 if(!databaseUrl||!serviceKey)return new Response('Server configuration unavailable',{status:503});
 if(active.size>=256)return new Response('Capacity reached',{status:503});
 const ipBytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode((request.headers.get('x-forwarded-for')||'unknown').split(',').pop()!.trim()));
 const ip=Array.from(new Uint8Array(ipBytes),value=>value.toString(16).padStart(2,'0')).join('');
 const {socket,response}=Deno.upgradeWebSocket(request,{idleTimeout:30});active.add(socket);
 const connection=crypto.randomUUID();let auth:{sessionId:string;token:string}|null=null,stateJson='',work:Promise<void>=Promise.resolve(),queued=0,count=0,bucket=Date.now();
 const send=(value:unknown)=>{if(socket.readyState===1){if(socket.bufferedAmount>256_000){socket.close(4400,'Buffer limit');return;}socket.send(JSON.stringify(value));}};
 const failure=(error:unknown,id?:string)=>{
  const message=error instanceof Error&&error.name!=='ZodError'?error.message:'Invalid request.';
  const code=/Session expired or revoked|Session authorization rejected/.test(message)?'SESSION_ENDED':/Session opened elsewhere/.test(message)?'SESSION_SUPERSEDED':'REQUEST_REJECTED';
  send({id,ok:false,error:message,code});if(code==='SESSION_ENDED'){send({event:'ended',reason:'Session ended. Pair again.'});socket.close(4403,'Session ended');}if(code==='SESSION_SUPERSEDED')socket.close(4409,'Session opened elsewhere');
 };
 const poll=async()=>{if(!auth||socket.readyState!==1)return;const result=await rpc({op:'poll',auth},connection,ip);const current=JSON.stringify(result.session);if(current!==stateJson){stateJson=current;send({event:'state',session:result.session});}
 for(const signal of result.signals||[]){const parsed=signalSchema.safeParse(signal);if(parsed.success)send({event:'signal',signal:parsed.data});}
 if(['revoked','expired'].includes(result.session.status))socket.close(4403,'Session ended');
 };
 socket.onmessage=event=>{
  if(typeof event.data!=='string'||event.data.length>72_000){socket.close(4400,'Invalid frame');return;}
  if(Date.now()-bucket>60_000){bucket=Date.now();count=0;}if(++count>600||queued>=32){socket.close(4429,'Rate limit');return;}
  queued++;work=work.then(async()=>{
   let id:string|undefined;
   try{
    const raw=JSON.parse(event.data);id=typeof raw?.id==='string'?raw.id:undefined;const message=requestSchema.parse(raw);
    if(message.op==='create'||message.op==='join'){if(auth)throw new Error('Revoke current session first.');}
    else if(message.op!=='inspect'&&message.op!=='attach'){if(!auth)throw new Error('Attach this authorized session first.');if(message.auth.sessionId!==auth.sessionId||message.auth.token!==auth.token)throw new Error('Session authorization rejected');}
    let result=await rpc(message,connection,ip);
    if(message.op==='create'||message.op==='join')auth={sessionId:result.credentials.sessionId,token:result.credentials.token};
    if(message.op==='attach')auth=message.auth;
    if(message.op==='configuration')result=await ice(result.sessionId,result.deviceId);
    send({id:message.id,ok:true,result});
    if(message.op==='revoke'){send({event:'ended',reason:'Session revoked.'});socket.close(4403,'Session revoked');return;}
    if(auth)await poll();
   }catch(error){failure(error,id);}finally{queued--;}
  }).catch(error=>failure(error));
 };
 const timer=setInterval(()=>{if(!queued&&auth&&socket.readyState===1){queued++;work=work.then(poll).catch(error=>failure(error)).finally(()=>{queued--;});}},1000);
 const timeout=setTimeout(()=>socket.close(1012,'Reconnect to resume the temporary session'),110_000);
 const bootstrap=setTimeout(()=>{if(!auth)socket.close(4401,'Pairing request timed out');},30_000);
 const cleanup=()=>{clearInterval(timer);clearTimeout(timeout);clearTimeout(bootstrap);active.delete(socket);auth=null;};
 socket.onclose=cleanup;socket.onerror=cleanup;
 return response;
});
