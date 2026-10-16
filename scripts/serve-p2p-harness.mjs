import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const directory=process.argv[2];
if(!directory||!path.isAbsolute(directory))throw new Error('Provide the absolute test harness directory.');
createServer(async(request,response)=>{const name=request.url==='/'?'index.html':request.url==='/harness.js'?'harness.js':null;if(!name){response.writeHead(404);response.end();return;}try{const content=await readFile(path.join(directory,name));response.writeHead(200,{'Content-Type':name.endsWith('.js')?'application/javascript':'text/html','Cache-Control':'no-store'});response.end(content);}catch{response.writeHead(404);response.end();}}).listen(3011,'localhost',()=>console.log('Test-only RTC harness: http://localhost:3011'));
