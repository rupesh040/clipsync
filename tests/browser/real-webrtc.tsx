import {useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {ClipboardPeer} from '../../packages/transport/peer';
import {LocalClipboardStore} from '../../lib/local-clipboard';
import {MemorySignalBus,waitFor} from '../helpers/memory-signaling';

const firstId='11111111-1111-4111-8111-111111111111';
const secondId='22222222-2222-4222-8222-222222222222';
const received=new LocalClipboardStore('test-only');
function BrowserHarness(){
  const [result,setResult]=useState('Not run');const [busy,setBusy]=useState(false);const [states,setStates]=useState<Record<string,string>>({});
  const snapshot=useSyncExternalStore(received.subscribe,received.getSnapshot,received.getServerSnapshot);
  async function run(){
    setBusy(true);setResult('Running real browser WebRTC test…');received.mutate('clear');
    const bus=new MemorySignalBus();let reverse='';const latestStates=new Map<string,string>();
    const update=(id:string,state:string)=>{latestStates.set(id,state);setStates(current=>({...current,[id]:state}));};
    const first=new ClipboardPeer({local:firstId,remote:secondId,signaling:bus.endpoint(firstId,secondId),configuration:async()=>({iceServers:[]}),onState:state=>update('PC',state),onClipboard:message=>{reverse=message.text;}});
    const second=new ClipboardPeer({local:secondId,remote:firstId,signaling:bus.endpoint(secondId,firstId),configuration:async()=>({iceServers:[]}),onState:state=>update('Phone',state),onClipboard:message=>received.receive(message,'Real browser RTC peer')});
    try{
      await Promise.all([first.start(),second.start()]);await waitFor(()=>latestStates.get('PC')==='connected'&&latestStates.get('Phone')==='connected',15000);
      const payload='Real RTCDataChannel delivery.\nLine two: café 🙂\n  Whitespace stays intact.  ';
      await first.send(payload,'page-copy');await waitFor(()=>received.getSnapshot().latest?.content===payload);await second.send('Reverse RTC delivery','user-read');
      if(reverse!=='Reverse RTC delivery')throw new Error('Reverse delivery failed.');
      bus.available.get(firstId)!(false);bus.available.get(firstId)!(true);await waitFor(()=>latestStates.get('PC')==='connected',15000);await first.send(payload,'page-copy');
      setResult('PASS: real WebRTC bidirectional delivery, acknowledgements, React store display, preserved text, and reconnection. Signaling here is a test-only in-memory adapter, not Supabase authentication.');
    }catch(error){setResult('FAIL: '+(error instanceof Error?error.message:String(error)));}
    finally{await Promise.all([first.stop(),second.stop()]);setBusy(false);}
  }
  return <main><h1>Clipsync · real-browser transport test</h1><p>Test-only synthetic text. Two real RTCPeerConnections, no clipboard reads, no account sessions, no cloud payloads.</p><button disabled={busy} onClick={()=>void run()}>Run real WebRTC tests</button><p role="status">{result}</p><pre>{JSON.stringify(states,null,2)}</pre><h2>Received into React state</h2><pre id="received-text">{snapshot.latest?.content||'Waiting for the test.'}</pre></main>;
}
createRoot(document.getElementById('root')!).render(<BrowserHarness/>);
