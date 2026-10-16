import type { ExtensionResponse,ExtensionSettings,ExtensionState } from './types';

const element=<Type extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as Type;
const input=(id:string)=>element<HTMLInputElement>(id);
let current:ExtensionState|undefined;
let busy=false;
function message(value:string){element('message').textContent=value;}
async function command(action:string,values:Record<string,unknown>={}){
  const result:ExtensionResponse=await chrome.runtime.sendMessage({target:'worker',action,...values});
  if(!result?.ok)throw new Error(result?.error||'Extension helper unavailable.');
  if(result.state)render(result.state);
  return result;
}
function render(state:ExtensionState){
  current=state;element('status').textContent=state.status;element('detail').textContent=state.detail;element('auth').hidden=state.signedIn;element('workspace').hidden=!state.signedIn;
  for(const key of ['enabled','paused','poll','write'] as const)input(key).checked=state.settings[key];
  if(document.activeElement!==input('app-origin'))input('app-origin').value=state.settings.appOrigin;
  if(document.activeElement!==input('name'))input('name').value=state.settings.name;
  const select=element<HTMLSelectElement>('peer');const previous=state.settings.peerId;
  select.replaceChildren(new Option('Select a device',''));
  for(const device of state.devices)if(!device.revoked&&device.id!==state.settings.deviceId)select.add(new Option(device.name,device.id));
  select.value=previous;
  element('pair-code').textContent=state.pairCode;element('pair-expiry').textContent=state.pairExpires?'Expires '+new Date(state.pairExpires).toLocaleTimeString():'';
  element('confirm-pair').hidden=state.pairMode!=='create';element('cancel-pair').hidden=!state.pairMode;
  element('pairing').hidden=state.devices.some(device=>device.id===state.settings.deviceId&&!device.revoked);
  element('receipt').textContent='Last confirmed receipt: '+(state.lastReceipt?new Date(state.lastReceipt).toLocaleTimeString():'none');
  element('clipboard-error').textContent=state.clipboardError;
  element('relay').textContent=state.relayConfigured===false?'TURN relay is not configured; restrictive networks may fail.':'';
}
async function run(action:()=>Promise<unknown>){if(busy)return;busy=true;message('');try{await action();}catch(error){message(error instanceof Error?error.message:'Operation failed.');}finally{busy=false;}}
function bind(id:string,action:()=>Promise<unknown>){element(id).addEventListener('click',()=>{void run(action);});}
async function update(settings:Partial<ExtensionSettings>){await command('saveSettings',{settings});}
for(const key of ['enabled','paused','poll','write'] as const)input(key).addEventListener('change',()=>{void run(()=>update({[key]:input(key).checked}));});
element('peer').addEventListener('change',()=>{void run(()=>update({peerId:element<HTMLSelectElement>('peer').value}));});
bind('request-code',async()=>{await command('requestCode',{email:input('email').value});message('Check your email for the numeric code. Configure the Supabase email template if it only contains a link.');});
bind('verify-code',()=>command('verifyCode',{email:input('email').value,code:input('code').value}));
bind('create-pair',async()=>{await update({name:input('name').value.trim()});await command('createPair');});
bind('join-pair',async()=>{await update({name:input('name').value.trim()});await command('joinPair',{code:input('join-code').value.toUpperCase()});message('Confirm this request on the phone, then choose Verify phone approval.');});
for(const [id,action] of [['confirm-pair','confirmPair'],['cancel-pair','cancelPair'],['verify-pair','verifyPair'],['reconnect','reconnect'],['disconnect','disconnect'],['read-now','readNow'],['copy-last','copyReceived'],['sign-out','signOut']])bind(id,()=>command(action));
bind('show-last',async()=>{const result=await command('showReceived');const field=element<HTMLTextAreaElement>('received');field.value=String(result.value||'');field.hidden=false;field.focus();field.select();});
element('enable-site').addEventListener('click',()=>{
  void chrome.tabs.query({active:true,currentWindow:true}).then(async tabs=>{
    const tab=tabs[0];if(!tab?.url||!/^https?:/.test(tab.url)||!tab.id)throw new Error('Open an ordinary HTTP/HTTPS page first. Browser-internal and store pages cannot be monitored.');
    const origin=new URL(tab.url).origin+'/*';
    const granted=await chrome.permissions.request({origins:[origin]});if(!granted)throw new Error('Site permission was declined.');
    await command('registerSites');await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});message('Copy capture enabled for this site. Enable the clipboard bridge to send detected copies.');
  }).catch(error=>message(error instanceof Error?error.message:'Unable to enable this site.'));
});
element('save-origin').addEventListener('click',()=>{
  let origin:string;try{origin=new URL(input('app-origin').value).origin;}catch{message('Enter a valid application origin.');return;}
  void chrome.permissions.request({origins:[origin+'/*']}).then(granted=>{if(!granted)throw new Error('App origin permission declined.');return update({appOrigin:origin});}).catch(error=>message(error.message));
});
element('open-app').addEventListener('click',event=>{event.preventDefault();void chrome.tabs.create({url:(current?.settings.appOrigin||input('app-origin').value)+'/dashboard/'});});
element('extension-origin').textContent=chrome.runtime.getURL('').replace(/\/$/,'');
void run(()=>command('status'));
setInterval(()=>{if(!busy)void command('status').catch(()=>message('Helper is unavailable. Reopen the extension or reconnect.'));},2000);
