import {useRef,useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import QRCode from 'qrcode';
import QrScanner from 'qr-scanner';
import {GuestClient} from '../../packages/pairing/client';
import {parsePairingQr} from '../../packages/pairing/protocol';
import {GuestSignaling} from '../../packages/transport/guest-signaling';
import {ClipboardPeer} from '../../packages/transport/peer';
import {LocalClipboardStore} from '../../lib/local-clipboard';
import {waitFor} from '../helpers/memory-signaling';
import {deployedSignaling} from '../../lib/deployment';
const store=new LocalClipboardStore('test-only-qr');
function Harness(){
 const [result,setResult]=useState('Not run'),[busy,setBusy]=useState(false),canvas=useRef<HTMLCanvasElement>(null);
 const received=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getServerSnapshot);
 async function run(rotation=false){
  setBusy(true);setResult('Testing local QR decoding, actual WebSocket signaling, and actual WebRTC…');store.mutate('clear');
  const host=new GuestClient(deployedSignaling,'clipsync'),phone=new GuestClient(deployedSignaling,'clipsync');
  let first:ClipboardPeer|undefined,second:ClipboardPeer|undefined,reverse='',wasOnline=false,sawOutage=false,recovered=false;
  const unsubscribe=host.subscribe(()=>{const online=host.getSnapshot().online;if(wasOnline&&!online)sawOutage=true;if(sawOutage&&online)recovered=true;wasOnline=online;});
  try{
   await host.create('Test-only PC');const qr=host.getSnapshot().qr!;
   await QRCode.toCanvas(canvas.current!,JSON.stringify(qr),{width:400,errorCorrectionLevel:'M'});
   const decoded=await QrScanner.scanImage(canvas.current!,{returnDetailedScanResult:true});
   const parsed=parsePairingQr(decoded.data,'clipsync');
   await phone.inspect({sessionId:parsed.sessionId,secret:parsed.secret});
   await phone.join({sessionId:parsed.sessionId,secret:parsed.secret},'Test-only phone');await host.confirm();
   await waitFor(()=>phone.getSnapshot().session?.status==='approved',5000);
   const hostSession=host.getSnapshot().session!,phoneSession=phone.getSnapshot().session!,states=new Map<string,string>();
   const make=(client:GuestClient,local:string,remote:string,onClipboard:(text:string)=>void)=>{
    const signaling=new GuestSignaling(client);
    return new ClipboardPeer({local,remote,signaling,configuration:()=>signaling.configuration(),onState:state=>states.set(local,state),onClipboard:message=>onClipboard(message.text)});
   };
   first=make(host,hostSession.deviceId,phoneSession.deviceId,text=>{reverse=text;});
   second=make(phone,phoneSession.deviceId,hostSession.deviceId,text=>store.receive({version:1,id:crypto.randomUUID(),source:hostSession.deviceId,destination:phoneSession.deviceId,session:crypto.randomUUID(),timestamp:Date.now(),type:'clipboard',origin:'page-copy',text},'Real login-free WebRTC peer'));
   await Promise.all([first.start(),second.start()]);await waitFor(()=>states.get(hostSession.deviceId)==='connected'&&states.get(phoneSession.deviceId)==='connected',25000);
   const text='Login-free WebRTC delivery.\nQR decoded locally. café 🙂';
   await first.send(text,'page-copy');if(store.getSnapshot().latest?.content!==text)throw new Error('React store mismatch');
   await second.send('Reverse clipboard text','user-read');if(reverse!=='Reverse clipboard text')throw new Error('Reverse delivery mismatch');
   if(rotation){setResult('Initial delivery passed. Waiting for the deployed worker’s 110-second rotation and automatic recovery…');await waitFor(()=>recovered,135_000);}
   await phone.reconnect();await waitFor(()=>states.get(hostSession.deviceId)==='connected'&&states.get(phoneSession.deviceId)==='connected',25000);
   await first.send('After reconnect\n'+text);
   await host.revoke();
   setResult('PASS: generated QR decoded by qr-scanner; login-free pairing and PC confirmation; real WebSocket signaling; two real RTCPeerConnections delivered both ways, updated React, '+(rotation?'automatically recovered after live worker rotation, ':'reattached, ')+ 'and revoked. No account, camera, or OS clipboard was used.');
  }catch(error){setResult('FAIL: '+(error instanceof Error?error.message:'Unknown test failure'));}
  finally{unsubscribe();await first?.stop();await second?.stop();host.close();phone.close();canvas.current?.getContext('2d')?.clearRect(0,0,400,400);setBusy(false);}
 }
 return <main><h1>Clipsync · login-free browser acceptance</h1><p>Uses the live deployed WSS signaling service and browser WebRTC. QR credentials are test-only and revoked at completion. This does not claim physical-camera or extension installation testing.</p><button disabled={busy} onClick={()=>void run()}>Run login-free acceptance</button> <button disabled={busy} onClick={()=>void run(true)}>Test worker-rotation recovery</button><p role="status">{result}</p><canvas ref={canvas} hidden/><h2>Received into React state</h2><pre>{received.latest?.content||'Waiting for test'}</pre></main>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
