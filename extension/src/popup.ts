import QRCode from 'qrcode';
import type {ExtensionState,ExtensionResponse,ExtensionSettings} from './types';
const element=<Type extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as Type;
const input=(id:string)=>element<HTMLInputElement>(id);
let busy=false,qr='',current:ExtensionState|undefined;
function message(value:string){element('message').textContent=value;}
async function command(action:string,values:Record<string,unknown>={}){
 const response:ExtensionResponse=await chrome.runtime.sendMessage({target:'worker',action,...values});if(!response?.ok)throw new Error(response?.error||'Helper unavailable.');if(response.state)render(response.state);return response;
}
function render(state:ExtensionState){
 current=state;element('status').textContent=state.status;element('detail').textContent=state.detail;
 for(const key of ['enabled','paused','poll','write'] as const)input(key).checked=state.settings[key];
 if(document.activeElement!==input('name'))input('name').value=state.settings.name;
 if(document.activeElement!==input('app-origin'))input('app-origin').value=state.settings.appOrigin;
 const session=state.session;element('session').textContent=session?session.deviceName+' ↔ '+(session.peerName||'Waiting for phone'):'No session';
 element('pair-code').textContent=state.pairCode.match(/.{1,4}/g)?.join(' ')||'';
 element('qr').hidden=!state.qr;
 if(state.qr!==qr){qr=state.qr;if(qr)void QRCode.toCanvas(element<HTMLCanvasElement>('qr'),qr,{width:260,margin:2,errorCorrectionLevel:'M'}).catch(()=>message('QR could not render. Use the code fallback.'));}
 element('expiry').textContent=session?'Expires in '+Math.max(0,Math.ceil((session.expiresAt-Date.now())/1000))+'s':'';
 element('confirm-pair').hidden=session?.status!=='pending';
 element('verification').textContent=session?.verification?'Compare on phone: '+session.verification:'';
 element('receipt').textContent='Last receipt: '+(state.lastReceipt?new Date(state.lastReceipt).toLocaleTimeString():'none');
 element('clipboard-error').textContent=state.clipboardError;element('relay').textContent=state.relayConfigured===false?'TURN is not configured; restrictive networks may fail.':'';
}
async function run(action:()=>Promise<unknown>){if(busy)return;busy=true;message('');try{await action();}catch(error){message(error instanceof Error?error.message:'Operation failed.');}finally{busy=false;}}
function bind(id:string,action:()=>Promise<unknown>){element(id).addEventListener('click',()=>{void run(action);});}
const update=(settings:Partial<ExtensionSettings>)=>command('saveSettings',{settings});
for(const key of ['enabled','paused','poll','write'] as const)input(key).addEventListener('change',()=>{void run(()=>update({[key]:input(key).checked}));});
bind('create-pair',async()=>{await update({name:input('name').value.trim()||'My PC extension'});await command('createPair');});
for(const[id,action]of [['confirm-pair','confirmPair'],['cancel-pair','cancelPair'],['disconnect','disconnect'],['reconnect','reconnect'],['read-now','readNow'],['copy-last','copyReceived']])bind(id,()=>command(action));
bind('show-last',async()=>{const response=await command('showReceived');const field=element<HTMLTextAreaElement>('received');field.value=String(response.value||'');field.hidden=false;field.focus();field.select();});
element('enable-site').addEventListener('click',()=>{
 void chrome.tabs.query({active:true,currentWindow:true}).then(async tabs=>{const tab=tabs[0];if(!tab?.url||!/^https?:/.test(tab.url)||!tab.id)throw new Error('Open an ordinary trusted webpage first.');
 const granted=await chrome.permissions.request({origins:[new URL(tab.url).origin+'/*']});if(!granted)throw new Error('Site permission declined.');await command('registerSites');await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});message('Capture allowed on this site. Enable the bridge to send copies.');}).catch(error=>message(error.message));
});
element('save-origin').addEventListener('click',()=>{let origin:string;try{origin=new URL(input('app-origin').value).origin;}catch{message('Enter a valid app origin.');return;}void chrome.permissions.request({origins:[origin+'/*']}).then(granted=>{if(!granted)throw new Error('Permission declined.');return update({appOrigin:origin});}).catch(error=>message(error.message));});
element('open-app').addEventListener('click',event=>{event.preventDefault();void chrome.tabs.create({url:(current?.settings.appOrigin||__APP_ORIGIN__)+'/dashboard/'});});
element('extension-origin').textContent=chrome.runtime.getURL('').replace(/\/$/,'');
void run(()=>command('status'));
setInterval(()=>{if(!busy)void command('status').catch(()=>message('Helper unavailable. Reopen the extension.'));},1000);
