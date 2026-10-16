import {observeCopies} from '../../lib/copy-events';
const captureState=globalThis as typeof globalThis & {clipsyncCaptureReady?:boolean};
if(!captureState.clipsyncCaptureReady){captureState.clipsyncCaptureReady=true;observeCopies(document,text=>{void chrome.runtime.sendMessage({target:'worker',action:'pageCopy',text}).catch(()=>{});});}
