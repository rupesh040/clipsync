export async function readDesktopClipboard(){
  if(navigator.clipboard?.readText){try{return await navigator.clipboard.readText();}catch{}}
  const field=document.querySelector<HTMLTextAreaElement>('#clipboard-buffer')!;
  field.value='';field.focus();
  if(!document.execCommand('paste'))throw new Error('Browser denied clipboard reading. Permitted webpage copy events still work.');
  const text=field.value;field.value='';return text;
}
export async function writeDesktopClipboard(text:string){
  if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);return;}catch{}}
  const field=document.querySelector<HTMLTextAreaElement>('#clipboard-buffer')!;
  field.value=text;field.focus();field.select();const copied=document.execCommand('copy');field.value='';
  if(!copied)throw new Error('PC clipboard write was denied. Received text remains in the helper until it closes.');
}
