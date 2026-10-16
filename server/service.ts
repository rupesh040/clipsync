import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import {requestSchema} from '../packages/pairing/protocol';
import {signalSchema} from '../packages/transport/signals';
import {turnCredentials} from '../lib/rtc-credentials';
import {PairingStore,RateLimits} from './pairing-store';

type Options={origins:string[];serviceId:string;now?:()=>number;stun?:string[];turn?:string[];turnSecret?:string;turnTtl?:number};
type Binding={sessionId:string;role:'host'|'phone'};
export function createSignalingService(options:Options){
 const store=new PairingStore(options.serviceId,options.now),limits=new RateLimits(options.now),bindings=new Map<WebSocket,Binding>();
 const server=createServer((request,response)=>{response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');if(request.url==='/health'&&request.method==='GET'){response.writeHead(200,{'Content-Type':'application/json'});response.end('{"status":"ready"}');}else{response.writeHead(404);response.end();}});
 const sockets=new WebSocketServer({noServer:true,maxPayload:72_000,perMessageDeflate:false});
 const send=(socket:WebSocket,value:unknown)=>{if(socket.readyState===WebSocket.OPEN){if(socket.bufferedAmount>256_000){socket.terminate();return;}socket.send(JSON.stringify(value));}};
 const publish=(id:string)=>{for(const state of store.states(id))for(const[socket,binding]of bindings)if(binding.sessionId===id&&binding.role===state.role)send(socket,{event:'state',session:state});};
 const bind=(socket:WebSocket,binding:Binding)=>{const current=bindings.get(socket);if(current&&current.sessionId!==binding.sessionId)throw new Error('Use a fresh connection for a different session.');for(const[old,value]of bindings)if(old!==socket&&value.sessionId===binding.sessionId&&value.role===binding.role){bindings.delete(old);old.close(4409,'Session opened elsewhere');}bindings.set(socket,binding);};
 server.on('upgrade',(request,socket,head)=>{
  try{
   if(request.url!=='/signal'||!request.headers.origin||!options.origins.includes(request.headers.origin))throw new Error('Origin rejected');
   const ip=request.socket.remoteAddress||'unknown';limits.take('upgrade:'+ip,30);if(sockets.clients.size>=256)throw new Error('Capacity reached');
   sockets.handleUpgrade(request,socket,head,connection=>{sockets.emit('connection',connection,request);});
  }catch{socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();}
 });
 sockets.on('connection',(socket,request)=>{
  const ip=request.socket.remoteAddress||'unknown';
  let alive=true;const ping=setInterval(()=>{if(!alive){socket.terminate();return;}alive=false;socket.ping();},25_000);
  const unauthenticated=setTimeout(()=>{if(!bindings.has(socket))socket.close(4401,'Pairing request timed out');},30_000);
  socket.on('pong',()=>{alive=true;});
  socket.on('error',()=>{});
  socket.on('close',()=>{bindings.delete(socket);clearInterval(ping);clearTimeout(unauthenticated);});
  socket.on('message',(raw,binary)=>{
   let requestId:string|undefined;
   try{
    limits.take('messages:'+ip,600);if(binary)throw new Error('Text protocol required.');
    const input=JSON.parse(raw.toString());requestId=typeof input?.id==='string'?input.id:undefined;
    const message=requestSchema.parse(input);
    let result:unknown;
    if(message.op==='create'){
     if(bindings.has(socket))throw new Error('Revoke the current session first.');
     limits.take('create:'+ip,6);limits.take('create:global',120);
     const created=store.create(message.name);bind(socket,{sessionId:created.credentials.sessionId,role:'host'});result=created;
    }else if(message.op==='inspect'||message.op==='join'){
     limits.take('pair:'+ip,12);limits.take('pair:global',300);
     if(message.op==='inspect')result=store.inspect(message.proof);
     else{if(bindings.has(socket))throw new Error('Already paired. Disconnect first.');const joined=store.join(message.proof,message.name);bind(socket,{sessionId:joined.credentials.sessionId,role:'phone'});result=joined;publish(joined.credentials.sessionId);}
    }else{
     const authenticated=store.authenticate(message.auth),bound=bindings.get(socket);
     if(message.op!=='attach'&&(!bound||bound.sessionId!==message.auth.sessionId||bound.role!==authenticated.role))throw new Error('Attach this authorized session first.');
     if(message.op==='attach'){bind(socket,{sessionId:message.auth.sessionId,role:authenticated.role});result={session:store.state(message.auth)};}
     else if(message.op==='confirm'){result={session:store.confirm(message.auth)};publish(message.auth.sessionId);}
     else if(message.op==='revoke'){const id=store.revoke(message.auth);send(socket,{id:message.id,ok:true,result:{revoked:true}});publish(id);for(const[connection,binding]of bindings)if(binding.sessionId===id){bindings.delete(connection);connection.close(4403,'Session revoked');}return;}
     else if(message.op==='authorize')result={authorized:store.authorized(message.auth)};
     else if(message.op==='configuration'){
      if(!store.authorized(message.auth))throw new Error('Pairing is not confirmed.');limits.take('config:'+message.auth.sessionId,120,3_600_000);
      const route=store.route(message.auth),iceServers:RTCIceServer[]=[{urls:options.stun?.length?options.stun:['stun:stun.l.google.com:19302']}];
      let expiresAt:number|null=null;
      if(options.turn?.length&&options.turnSecret){const credentials=turnCredentials(options.turnSecret,route.sessionId,route.local,options.turnTtl,options.now?.());expiresAt=credentials.expiresAt;iceServers.push({urls:options.turn,username:credentials.username,credential:credentials.credential});}
      result={iceServers,relayConfigured:expiresAt!==null,expiresAt};
     }else if(message.op==='signal'){
      limits.take('signal:'+message.auth.sessionId+':'+authenticated.role,180);
      const route=store.route(message.auth),signal=signalSchema.parse({...message.signal,id:randomUUID(),from_device:route.local,to_device:route.remote});
      if(signal.kind==='hello'&&Object.keys(signal.payload).length||['offer','answer'].includes(signal.kind)&&(!('sdp'in signal.payload)||signal.payload.type!==signal.kind)||signal.kind==='ice'&&!('candidate'in signal.payload))throw new Error('Invalid signaling metadata.');
      for(const[connection,binding]of bindings)if(binding.sessionId===route.sessionId&&binding.role!==route.role)send(connection,{event:'signal',signal});
      result={accepted:true};
     }
    }
    send(socket,{id:message.id,ok:true,result});
   }catch(error){const message=error instanceof Error&&error.name!=='ZodError'?error.message:'Invalid request.';send(socket,{id:requestId,ok:false,error:message,code:/Session expired or revoked|Session authorization rejected/.test(message)?'SESSION_ENDED':'REQUEST_REJECTED'});}
  });
 });
 const cleanup=setInterval(()=>{for(const id of store.cleanup())for(const[socket,binding]of bindings)if(binding.sessionId===id){send(socket,{event:'ended',reason:'Session expired or revoked. Pair again.'});bindings.delete(socket);socket.close(4403,'Session ended');}},1000);
 return{server,store,close:async()=>{clearInterval(cleanup);for(const socket of sockets.clients)socket.terminate();await new Promise<void>(resolve=>sockets.close(()=>resolve()));await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
