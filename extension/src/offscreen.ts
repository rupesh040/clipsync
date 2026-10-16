import {GuestClient} from '../../packages/pairing/client';
import {GuestSignaling} from '../../packages/transport/guest-signaling';
import {ClipboardPeer} from '../../packages/transport/peer';
import {EchoGuard,textSchema} from '../../packages/protocol';
import {readDesktopClipboard,writeDesktopClipboard} from './clipboard';
import {defaults,type Command,type ExtensionSettings,type ExtensionState,type ExtensionResponse} from './types';
const client=new GuestClient(__SIGNALING_URL__,__SERVICE_ID__);
let settings={...defaults},peer:ClipboardPeer|null=null,status='unpaired',detail='Pair using a temporary QR. No email or account required.',latest='',lastReceipt='',clipboardError='',relayConfigured:boolean|null=null,activeKey='',captureBusy=false;
let revision=0;
const echo=new EchoGuard();
async function worker(action:string,values:Record<string,unknown>={}):Promise<ExtensionResponse>{const response=await chrome.runtime.sendMessage({target:'worker',action,...values});if(!response?.ok)throw new Error(response?.error||'Extension operation failed.');return response;}
function state():ExtensionState{const pair=client.getSnapshot();return{status:pair.error?'failed':status,detail:pair.error||detail,settings,session:pair.session,qr:pair.qr?JSON.stringify(pair.qr):'',pairCode:pair.code,lastReceipt,clipboardError,relayConfigured};}
async function configure(){
 const current=++revision,pair=client.getSnapshot(),session=pair.session;
 settings={...defaults,...(await worker('getSettings')).value as Partial<ExtensionSettings>};if(current!==revision)return;
 const key=session?.status==='approved'&&!settings.paused?session.sessionId+'|'+session.deviceId+'|'+session.peerId:'';
 if(key===activeKey&&peer)return;
 activeKey=key;const previous=peer;peer=null;await previous?.stop(false);if(current!==revision)return;
 if(!session){status='unpaired';detail='Choose Pair a device to generate a temporary QR.';return;}
 if(session.status==='waiting'||session.status==='pending'){status='pairing';detail=session.status==='waiting'?'Waiting for your phone to scan.':'Compare verification codes and confirm this phone.';return;}
 if(session.status!=='approved'){status='disconnected';detail='Session expired or revoked. Pair again.';return;}
 if(settings.paused){status='paused';detail='Devices approved. Resume to open WebRTC.';return;}
 const signaling=new GuestSignaling(client);
 const connection=new ClipboardPeer({local:session.deviceId,remote:session.peerId!,signaling,configuration:()=>signaling.configuration(value=>{relayConfigured=value;}),onState:(value,message)=>{status=value;detail=message;},onClipboard:async message=>{await echo.received(message.text);latest=message.text;lastReceipt=new Date().toISOString();if(settings.write)try{await writeDesktopClipboard(message.text);clipboardError='';}catch(error){clipboardError=error instanceof Error?error.message:'Clipboard write failed.';}},onReceipt:()=>{lastReceipt=new Date().toISOString();}});
 peer=connection;void connection.start();
}
let configureTimer:ReturnType<typeof setTimeout>|undefined;
client.subscribe(()=>{clearTimeout(configureTimer);configureTimer=setTimeout(()=>{void configure().catch(()=>{status='failed';detail='Unable to configure this session.';});},0);});
async function capture(text:string,origin:'page-copy'|'desktop-read'){
 if(!settings.enabled||settings.paused||captureBusy||!peer||status!=='connected')return;
 const parsed=textSchema.safeParse(text);if(!parsed.success){clipboardError='Text is empty or exceeds the 16 KiB UTF-8 limit.';return;}
 captureBusy=true;try{if(await echo.shouldSend(text)){await peer.send(text,origin);clipboardError='';}}catch(error){echo.reset();clipboardError=error instanceof Error?error.message:'Delivery failed.';}finally{captureBusy=false;}
}
async function execute(message:Command):Promise<ExtensionResponse>{
 if(message.action==='status')return{ok:true,state:state()};
 if(message.action==='configure'){activeKey='';await configure();return{ok:true,state:state()};}
 if(message.action==='pageCopy'){if(typeof message.text==='string')await capture(message.text,'page-copy');return{ok:true};}
 if(message.action==='createPair'){await client.create(settings.name);await configure();return{ok:true,state:state()};}
 if(message.action==='confirmPair'){await client.confirm();await configure();return{ok:true,state:state()};}
 if(message.action==='cancelPair'||message.action==='disconnect'){
  await peer?.stop();await client.revoke();latest='';echo.reset();activeKey='';status='disconnected';detail='Session revoked. Pair another device whenever you’re ready.';return{ok:true,state:state()};
 }
 if(message.action==='reconnect'){await client.reconnect();activeKey='';await configure();return{ok:true,state:state()};}
 if(message.action==='readNow'){if(status!=='connected'||!settings.enabled)throw new Error('Connect and enable PC clipboard capture first.');await capture(await readDesktopClipboard(),'desktop-read');return{ok:true,state:state()};}
 if(message.action==='copyReceived'){if(!latest)throw new Error('No received text.');await writeDesktopClipboard(latest);return{ok:true};}
 if(message.action==='showReceived')return{ok:true,value:latest};
 return{ok:false,error:'Unknown command.'};
}
const ready=configure().catch(()=>{status='failed';detail='Extension setup failed. Check the configured signaling URL.';});
chrome.runtime.onMessage.addListener((message:Command,sender,respond)=>{
 if(message?.target!=='offscreen'||sender.id!==chrome.runtime.id||sender.tab)return;
 void ready.then(()=>execute(message)).then(respond).catch(error=>respond({ok:false,error:error instanceof Error?error.message:'Operation failed.'}));return true;
});
const monitoring=setInterval(()=>{if(settings.enabled&&!settings.paused&&settings.poll&&!captureBusy&&status==='connected')void readDesktopClipboard().then(text=>capture(text,'desktop-read')).catch(error=>{clipboardError=error instanceof Error?error.message:'Reading unavailable.';});},1200);
window.addEventListener('unload',()=>{clearInterval(monitoring);clearTimeout(configureTimer);client.close();void peer?.stop(false);latest='';});
