import { build } from 'esbuild';
import nextEnvironment from '@next/env';
import { mkdir,readFile,writeFile,copyFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import sharp from 'sharp';

nextEnvironment.loadEnvConfig(process.cwd(),false);
await import('./check-public-env.mjs');
const output='extension/dist';
const projectUrl=process.env.NEXT_PUBLIC_SUPABASE_URL||'';
const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||'';
const appOrigin=new URL(process.env.NEXT_PUBLIC_SITE_URL||'https://clipsync-orcin.vercel.app').origin;
const signaling=process.env.NEXT_PUBLIC_SIGNALING_URL||'wss://hdwhtaovvfiyzthfrysr.supabase.co/functions/v1/clipsync-signal/signal';
const identity=JSON.parse(await readFile('extension/identity.json','utf8'));
const serviceId=process.env.NEXT_PUBLIC_SIGNALING_SERVICE_ID||'clipsync';
await mkdir(output+'/icons',{recursive:true});
await mkdir('public/downloads',{recursive:true});
await build({entryPoints:{background:'extension/src/background.ts',offscreen:'extension/src/offscreen.ts',popup:'extension/src/popup.ts'},bundle:true,outdir:output,format:'esm',platform:'browser',target:'chrome116',minify:true,define:{__SUPABASE_URL__:JSON.stringify(projectUrl),__SUPABASE_KEY__:JSON.stringify(key),__APP_ORIGIN__:JSON.stringify(appOrigin),__SIGNALING_URL__:JSON.stringify(signaling),__SERVICE_ID__:JSON.stringify(serviceId),'process.env.NODE_ENV':'"production"'},legalComments:'none'});
await build({entryPoints:['extension/src/content.ts'],bundle:true,outfile:output+'/content.js',format:'iife',platform:'browser',target:'chrome116',minify:true});
const hosts=[appOrigin+'/*'];if(signaling){const host=new URL(signaling);host.protocol=host.protocol==='wss:'?'https:':'http:';hosts.push(host.origin+'/*');}
const manifest={manifest_version:3,key:identity.key,name:'Clipsync PC bridge',version:'1.3.0',description:'Login-free QR pairing and opt-in WebRTC clipboard delivery.',minimum_chrome_version:'116',permissions:['storage','offscreen','clipboardRead','clipboardWrite','activeTab','scripting'],host_permissions:hosts,optional_host_permissions:['http://*/*','https://*/*'],background:{service_worker:'background.js',type:'module'},action:{default_popup:'popup.html',default_title:'Clipsync PC bridge'},icons:{48:'icons/icon-48.png',128:'icons/icon-128.png'},content_security_policy:{extension_pages:"script-src 'self'; object-src 'self'"}};
await writeFile(output+'/manifest.json',JSON.stringify(manifest,null,2));
for(const name of ['popup.html','popup.css','offscreen.html'])await copyFile('extension/'+name,output+'/'+name);
for(const size of [48,128])await sharp('public/icons/mark.svg').resize(size,size).png().toFile(output+`/icons/icon-${size}.png`);
const files=['manifest.json','background.js','content.js','offscreen.js','popup.js','popup.html','popup.css','offscreen.html','icons/icon-48.png','icons/icon-128.png'];
const entries={};for(const file of files)entries[file]=new Uint8Array(await readFile(output+'/'+file));
await writeFile('public/downloads/clipsync-extension.zip',zipSync(entries,{level:6}));
console.log('Built Manifest V3 extension in extension/dist and public/downloads/clipsync-extension.zip. No secret TURN credentials are bundled.');
