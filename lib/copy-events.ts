export function observeCopies(document:Document,onCopy:(text:string)=>void|Promise<unknown>){
 let work:Promise<unknown>=Promise.resolve(),active=true;
 const copied=(event:ClipboardEvent)=>{
  const target=event.target;
  if(target instanceof HTMLInputElement&&target.type==='password')return;
  const selection=target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement?target.value.slice(target.selectionStart||0,target.selectionEnd||0):document.getSelection()?.toString()||'';
  queueMicrotask(()=>{
   const text=event.clipboardData?.getData('text/plain')||(!event.defaultPrevented?selection:'');
   if(text.trim()&&new TextEncoder().encode(text).byteLength<=16_384)work=work.then(()=>{if(active)return onCopy(text);}).catch(()=>{});
  });
 };
 document.addEventListener('copy',copied);return()=>{active=false;document.removeEventListener('copy',copied);};
}
