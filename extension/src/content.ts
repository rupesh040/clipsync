const captureState=globalThis as typeof globalThis & {clipsyncCaptureReady?:boolean};
if(!captureState.clipsyncCaptureReady){captureState.clipsyncCaptureReady=true;document.addEventListener('copy',event=>{
  const target=event.target;
  if(target instanceof HTMLInputElement&&target.type==='password')return;
  let selection=window.getSelection()?.toString()||'';
  if(target instanceof HTMLTextAreaElement||target instanceof HTMLInputElement)selection=target.value.slice(target.selectionStart||0,target.selectionEnd||0);
  setTimeout(()=>{
    const explicit=event.clipboardData?.getData('text/plain')||'';
    const text=explicit||(!event.defaultPrevented?selection:'');
    if(text.trim()&&text.length<=20_000)void chrome.runtime.sendMessage({target:'worker',action:'pageCopy',text}).catch(()=>{});
  },0);
});}
