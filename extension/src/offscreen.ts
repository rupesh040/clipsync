import { createClient } from '@supabase/supabase-js';
import { EchoGuard, textSchema } from '../../packages/protocol';
import { ClipboardPeer } from '../../packages/transport/peer';
import { SupabaseSignaling } from '../../packages/transport/supabase-signaling';
import { fetchRtcConfiguration } from '../../packages/transport/configuration';
import { readDesktopClipboard,writeDesktopClipboard } from './clipboard';
import { defaults,type Command,type ExtensionResponse,type ExtensionSettings,type ExtensionState } from './types';

async function worker(action:string,values:Record<string,unknown>={}):Promise<ExtensionResponse>{const result=await chrome.runtime.sendMessage({target:'worker',action,...values});if(!result?.ok)throw new Error(result?.error||'Extension storage is unavailable.');return result;}
const client=__SUPABASE_URL__&&__SUPABASE_KEY__?createClient(__SUPABASE_URL__,__SUPABASE_KEY__,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storage:{
    getItem:async key=>(await worker('storageGet',{key:'auth:'+key})).value as string|null,
    setItem:async(key,value)=>{await worker('storageSet',{key:'auth:'+key,value});},
    removeItem:async key=>{await worker('storageRemove',{key:'auth:'+key});},
  }},
}):null;
let settings:ExtensionSettings={...defaults};
let identity:string|null=null;
let email='';
let devices:ExtensionState['devices']=[];
let peer:ClipboardPeer|null=null;
let status='Sign in required';
let detail='Request an email code to authorize the extension.';
let pairCode='';let pairExpires='';let pairMode:ExtensionState['pairMode']='';
let lastReceipt='';let clipboardError='';let relayConfigured:boolean|null=null;
let latest='';let captureBusy=false;let revision=0;
const echo=new EchoGuard();
let monitoring:ReturnType<typeof setInterval>|undefined;
let metadata:ReturnType<typeof setInterval>|undefined;

function state():ExtensionState{return{signedIn:Boolean(identity),email,status,detail,settings,devices,pairCode,pairExpires,pairMode,lastReceipt,clipboardError,relayConfigured};}
async function saveSettings(patch:Partial<ExtensionSettings>){settings={...settings,...patch};await worker('saveSettings',{settings});}
async function refreshDevices(){if(!client||!identity)return;const result=await client.from('devices').select('id,name,platform,revoked');if(result.error)throw new Error('Unable to load authorized devices.');devices=result.data||[];}
async function configure(){
  const current=++revision;
  const previous=peer;peer=null;if(previous)await previous.stop(false);
  settings={...defaults,...(await worker('getSettings')).value as Partial<ExtensionSettings>};
  if(!client||!identity){status='Sign in required';return;}
  await refreshDevices();if(current!==revision)return;
  if(!settings.enabled){status='Disabled';detail='Enable capture explicitly to start.';return;}
  if(settings.paused){status='Paused';return;}
  if(!devices.some(device=>device.id===settings.deviceId&&!device.revoked)){status='Unpaired';detail='Authorize this extension with the phone pairing flow.';return;}
  const remote=settings.peerId||devices.find(device=>device.id!==settings.deviceId&&!device.revoked)?.id;
  if(!remote||!devices.some(device=>device.id===remote&&!device.revoked)){status='Unpaired';detail='Select an authorized phone.';return;}
  const connection=new ClipboardPeer({local:settings.deviceId,remote,signaling:new SupabaseSignaling(client,settings.deviceId,remote),configuration:()=>fetchRtcConfiguration(client!,settings.deviceId,settings.appOrigin,enabled=>{relayConfigured=enabled;}),onState:(value,description)=>{status=value;detail=description;},onClipboard:async message=>{
    await echo.received(message.text);latest=message.text;lastReceipt=new Date().toISOString();
    if(settings.write){try{await writeDesktopClipboard(message.text);clipboardError='';}catch(error){clipboardError=error instanceof Error?error.message:'PC clipboard write failed.';}}
  },onReceipt:()=>{lastReceipt=new Date().toISOString();}});
  peer=connection;void connection.start();
}

async function capture(text:string,origin:'page-copy'|'desktop-read'){
  if(!settings.enabled||settings.paused||captureBusy||!peer||status!=='connected')return;
  const parsed=textSchema.safeParse(text);if(!parsed.success){clipboardError='Detected text is empty or exceeds the 16 KiB limit.';return;}
  captureBusy=true;
  try{if(await echo.shouldSend(text)){await peer.send(text,origin);clipboardError='';}}
  catch(error){echo.reset();clipboardError=error instanceof Error?error.message:'Clipboard delivery failed.';}
  finally{captureBusy=false;}
}

async function execute(message:Command):Promise<ExtensionResponse>{
  if(message.action==='status')return{ok:true,state:state()};
  if(message.action==='configure'){await configure();return{ok:true,state:state()};}
  if(message.action==='pageCopy'){if(typeof message.text==='string')await capture(message.text,'page-copy');return{ok:true};}
  if(!client)throw new Error('Build the extension with the Supabase public project settings.');
  if(message.action==='requestCode'){
    const address=String(message.email||'').trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)||address.length>254)throw new Error('Enter a valid email address.');
    const result=await client.auth.signInWithOtp({email:address});
    if(result.error){if(result.error.status===429)throw new Error('Supabase email rate limit reached. Wait or configure production SMTP.');throw new Error('Email delivery failed. Check SMTP and the email OTP template.');}
    return{ok:true};
  }
  if(message.action==='verifyCode'){
    const token=String(message.code||'').trim();if(!/^\d{6,10}$/.test(token))throw new Error('Enter the numeric code from your email.');
    const result=await client.auth.verifyOtp({email:String(message.email||'').trim(),token,type:'email'});if(result.error)throw new Error('Sign-in code expired or was rejected. Request a new code.');
    identity=result.data.user?.id||null;email=result.data.user?.email||'';await configure();return{ok:true,state:state()};
  }
  if(message.action==='signOut'){
    const previous=peer;peer=null;await previous?.stop(false);const result=await client.auth.signOut({scope:'local'});if(result.error)throw new Error('Unable to sign out.');identity=null;email='';latest='';echo.reset();settings.enabled=false;await saveSettings({enabled:false});return{ok:true,state:state()};
  }
  if(!identity)throw new Error('Sign in first.');
  if(message.action==='createPair'||message.action==='joinPair'){
    const result=await client.rpc('create_pairing',{device_name:settings.name,device_platform:'Windows desktop'});if(result.error)throw new Error(result.error.message);
    settings.deviceId=result.data.device_id;pairCode=result.data.code;pairExpires=result.data.expires_at;pairMode='create';
    await saveSettings({deviceId:settings.deviceId});
    if(message.action==='joinPair'){
      const joined=await client.rpc('join_pairing',{pairing_code:String(message.code||'').toUpperCase(),joining_device:settings.deviceId});if(joined.error)throw new Error(joined.error.message);pairMode='join';pairCode='';
    }
    return{ok:true,state:state()};
  }
  if(message.action==='confirmPair'){
    const result=await client.rpc('confirm_pairing',{pairing_code:pairCode});if(result.error)throw new Error(result.error.message);pairCode='';pairMode='';await configure();return{ok:true,state:state()};
  }
  if(message.action==='cancelPair'){
    if(pairCode){const result=await client.rpc('cancel_pairing',{pairing_code:pairCode});if(result.error)throw new Error(result.error.message);}pairCode='';pairMode='';return{ok:true,state:state()};
  }
  if(message.action==='verifyPair'){await refreshDevices();if(!devices.some(device=>device.id===settings.deviceId&&!device.revoked))throw new Error('Waiting for confirmation on the initiating device.');pairMode='';await configure();return{ok:true,state:state()};}
  if(message.action==='reconnect'){await configure();return{ok:true,state:state()};}
  if(message.action==='disconnect'){await saveSettings({enabled:false});return{ok:true,state:state()};}
  if(message.action==='copyReceived'){if(!latest)throw new Error('No text has arrived.');await writeDesktopClipboard(latest);return{ok:true};}
  if(message.action==='showReceived')return{ok:true,value:latest};
  if(message.action==='readNow'){await capture(await readDesktopClipboard(),'desktop-read');return{ok:true,state:state()};}
  return{ok:false,error:'Unknown extension command.'};
}

async function boot(){
  settings={...defaults,...(await worker('getSettings')).value as Partial<ExtensionSettings>};
  if(client){const user=await client.auth.getUser();identity=user.data.user?.id||null;email=user.data.user?.email||'';await configure();
    client.auth.onAuthStateChange((_event,session)=>{identity=session?.user.id||null;email=session?.user.email||'';setTimeout(()=>{void configure().catch(()=>{status='failed';detail='Authorization unavailable. Reconnect to continue.';});},0);});}
  monitoring=setInterval(()=>{if(settings.enabled&&!settings.paused&&settings.poll&&!captureBusy)void readDesktopClipboard().then(text=>capture(text,'desktop-read')).catch(error=>{clipboardError=error instanceof Error?error.message:'Clipboard reading unavailable.';});},1200);
  metadata=setInterval(()=>{if(client&&identity&&settings.deviceId&&settings.enabled&&!settings.paused)void client.rpc('heartbeat',{target_device:settings.deviceId});},30_000);
}
const ready=boot().catch(()=>{status='failed';detail='Extension initialization failed. Check public project configuration.';});
chrome.runtime.onMessage.addListener((message:Command,sender,respond)=>{
  if(message?.target!=='offscreen'||sender.id!==chrome.runtime.id||sender.tab)return;
  void ready.then(()=>execute(message)).then(respond).catch(error=>respond({ok:false,error:error instanceof Error?error.message:'Extension operation failed.'}));return true;
});
window.addEventListener('unload',()=>{clearInterval(monitoring);clearInterval(metadata);void peer?.stop(false);latest='';});
