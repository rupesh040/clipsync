import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

const output=process.argv[2];
if(!output||!path.isAbsolute(output))throw new Error('Provide an absolute scratch directory for the test-only browser harness.');
await mkdir(output,{recursive:true});
await build({entryPoints:['tests/browser/real-webrtc.tsx'],bundle:true,format:'esm',platform:'browser',outfile:path.join(output,'harness.js'),define:{'process.env.NODE_ENV':'"production"'}});
await writeFile(path.join(output,'index.html'),'<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clipsync transport test</title><style>body{font:15px/1.8 system-ui;background:#f7f7f5;color:#20231f;margin:40px}main{max-width:800px;margin:auto}button{padding:14px;background:#3d7257;color:white;border:0;border-radius:4px;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:20px;border:1px solid #e5e7e1;background:white}</style></head><body><div id="root"></div><script type="module" src="harness.js"></script></body></html>');
console.log('Built test-only browser harness in '+output);
