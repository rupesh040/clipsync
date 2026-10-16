import {createSignalingService} from './service';
const origins=(process.env.SIGNALING_ALLOWED_ORIGINS||'http://localhost:3000').split(',').map(value=>value.trim()).filter(Boolean);
if(!origins.length||origins.some(value=>value==='*'))throw new Error('Configure exact allowed app/extension origins.');
const service=createSignalingService({origins,serviceId:process.env.SIGNALING_SERVICE_ID||'clipsync',stun:(process.env.STUN_URLS||'').split(',').filter(value=>/^stuns?:/.test(value)),turn:(process.env.TURN_URLS||'').split(',').filter(value=>/^turns?:/.test(value)),turnSecret:process.env.TURN_SHARED_SECRET,turnTtl:Number(process.env.TURN_TTL_SECONDS)||600});
service.server.listen(Number(process.env.PORT)||3012,process.env.HOST||'127.0.0.1',()=>console.log('Clipsync signaling service ready. No pairing credentials or clipboard content are logged.'));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{void service.close().then(()=>process.exit(0));});
