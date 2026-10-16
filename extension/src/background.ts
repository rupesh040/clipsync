import { defaults, type Command, type ExtensionResponse, type ExtensionSettings } from './types';

let creating:Promise<void>|null=null;
async function helper(){
  const contexts=await chrome.runtime.getContexts({contextTypes:[chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],documentUrls:[chrome.runtime.getURL('offscreen.html')]});
  if(contexts.length)return;
  if(!creating){creating=chrome.offscreen.createDocument({url:'offscreen.html',reasons:[chrome.offscreen.Reason.CLIPBOARD,chrome.offscreen.Reason.WEB_RTC],justification:'Run the explicitly enabled clipboard bridge and WebRTC in a DOM-capable extension document.'}).finally(()=>{creating=null;});}
  await creating;
}
async function settings():Promise<ExtensionSettings>{const result=await chrome.storage.local.get('settings');return {...defaults,...(result.settings as Partial<ExtensionSettings>||{})};}
async function registerSites(){
  const permissions=await chrome.permissions.getAll();
  const origins=(permissions.origins||[]).filter(origin=>/^https?:\/\//.test(origin));
  await chrome.scripting.unregisterContentScripts().catch(()=>{});
  if(origins.length)await chrome.scripting.registerContentScripts([{id:'clipsync-copy-events',js:['content.js'],matches:origins,runAt:'document_idle',allFrames:false,persistAcrossSessions:true}]);
}

async function route(message:Command,sender:chrome.runtime.MessageSender):Promise<ExtensionResponse>{
  if(sender.id!==chrome.runtime.id)return {ok:false,error:'Sender rejected.'};
  const trustedPage=Boolean(sender.url?.startsWith(chrome.runtime.getURL('')))&&!sender.tab;
  if(message.action==='pageCopy'){
    if(!sender.tab||!sender.url||!/^https?:/.test(sender.url)||typeof message.text!=='string'||message.text.length>20_000)return {ok:false,error:'Copy event rejected.'};
    const permission=await chrome.permissions.contains({origins:[new URL(sender.url).origin+'/*']});
    const current=await settings();
    if(!permission||!current.enabled||current.paused)return {ok:false,error:'Capture is disabled for this site.'};
    await helper();return chrome.runtime.sendMessage({...message,target:'offscreen'});
  }
  if(!trustedPage)return {ok:false,error:'Only extension pages may control this helper.'};
  if(message.action==='recoveryGet'||message.action==='recoverySet'){
    if(sender.url!==chrome.runtime.getURL('offscreen.html')||typeof message.key!=='string'||!message.key.startsWith('recovery:')||message.key.length>100)return{ok:false,error:'Recovery storage access rejected.'};
    if(message.action==='recoveryGet'){const result=await chrome.storage.session.get(message.key);return{ok:true,value:result[message.key]??null};}
    if(message.value===null)await chrome.storage.session.remove(message.key);
    else{if(JSON.stringify(message.value).length>600_000)return{ok:false,error:'Recovery storage limit exceeded.'};await chrome.storage.session.set({[message.key]:message.value});}
    return{ok:true};
  }
  if(message.action==='storageGet'){
    if(typeof message.key!=='string'||!message.key.startsWith('auth:'))return {ok:false,error:'Storage key rejected.'};
    const result=await chrome.storage.local.get(message.key);return {ok:true,value:result[message.key]??null};
  }
  if(message.action==='storageSet'){
    if(typeof message.key!=='string'||!message.key.startsWith('auth:')||typeof message.value!=='string'||message.value.length>100_000)return {ok:false,error:'Storage value rejected.'};
    await chrome.storage.local.set({[message.key]:message.value});return {ok:true};
  }
  if(message.action==='storageRemove'){
    if(typeof message.key!=='string'||!message.key.startsWith('auth:'))return {ok:false,error:'Storage key rejected.'};
    await chrome.storage.local.remove(message.key);return {ok:true};
  }
  if(message.action==='getSettings')return {ok:true,value:await settings()};
  if(message.action==='saveSettings'){
    const current=await settings();
    const patch=message.settings as Partial<ExtensionSettings>;
    const app=new URL(patch.appOrigin||current.appOrigin);
    if(app.protocol!=='https:'&&!(app.protocol==='http:'&&['localhost','127.0.0.1'].includes(app.hostname)))return {ok:false,error:'Use HTTPS for the app origin.'};
    if(app.username||app.password||app.search||app.hash)return {ok:false,error:'Invalid app origin.'};
    const next={...current,...patch,appOrigin:app.origin};
    await chrome.storage.local.set({settings:next});await helper();return chrome.runtime.sendMessage({target:'offscreen',action:'configure'});
  }
  if(message.action==='registerSites'){await registerSites();return {ok:true};}
  await helper();return chrome.runtime.sendMessage({...message,target:'offscreen'});
}

chrome.runtime.onMessage.addListener((message:Command,sender,respond)=>{
  if(message?.target!=='worker')return;
  void route(message,sender).then(respond).catch(()=>respond({ok:false,error:'Extension operation failed. Check permissions and the app origin.'}));return true;
});
async function recoverHelper(){
  const stored=await chrome.storage.session.get('recovery:pair');const pair=stored['recovery:pair'] as {session?:{expiresAt?:number}}|undefined;
  if(pair?.session?.expiresAt&&pair.session.expiresAt>Date.now())await helper();
}
async function startup(){await registerSites();await chrome.alarms.create('clipsync-recovery',{periodInMinutes:1});await recoverHelper();}
chrome.runtime.onStartup.addListener(()=>{void startup().catch(()=>{});});
chrome.runtime.onInstalled.addListener(()=>{void startup().catch(()=>{});});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='clipsync-recovery')void recoverHelper().catch(()=>{});});
chrome.permissions.onAdded.addListener(()=>{void registerSites();});
chrome.permissions.onRemoved.addListener(()=>{void registerSites();});
