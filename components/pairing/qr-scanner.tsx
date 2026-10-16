'use client';
import {useEffect,useRef,useState} from 'react';
import {createQrCamera,stopQrCamera,cameraError,type ScannerHandle} from '@/lib/qr-camera';
export function QrCamera({onScan,onCancel}:{onScan:(raw:string)=>void;onCancel:()=>void}){
 const video=useRef<HTMLVideoElement>(null),scanner=useRef<ScannerHandle|null>(null);
 const [error,setError]=useState(''),[flash,setFlash]=useState(false);
 useEffect(()=>{
  let active=true,accepted=false;const element=video.current!;
  const stop=()=>stopQrCamera(scanner.current,element);
  const instance=createQrCamera(element,raw=>{if(!active||accepted)return;accepted=true;stop();onScan(raw);});
  scanner.current=instance;
  void instance.start().then(async()=>{if(!active){stop();return;}const supported=await instance.hasFlash();if(active)setFlash(supported);}).catch(failure=>{stop();if(active)setError(cameraError(failure));});
  const hide=()=>{if(document.visibilityState==='hidden'){stop();onCancel();}};
  document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',stop);
  return()=>{active=false;stop();document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',stop);};
 },[onScan,onCancel]);
 return <div className="camera-scanner"><div className="camera-frame"><video ref={video} muted playsInline aria-label="QR camera preview"/><span aria-hidden="true"/></div><p role={error?'alert':'status'}>{error||'Point your camera at the Clipsync QR code. Nothing is uploaded from the camera.'}</p><div className="button-row">{flash&&<button className="button" onClick={()=>void scanner.current?.toggleFlash().catch(()=>setError('Flashlight is unavailable.'))}>Toggle flashlight</button>}<button className="button" onClick={onCancel}>Stop camera / use code</button></div></div>;
}
