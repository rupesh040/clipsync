import QrScanner from 'qr-scanner';
export type ScannerHandle={start:()=>Promise<void>;stop:()=>void;destroy:()=>void;hasFlash:()=>Promise<boolean>;toggleFlash:()=>Promise<void>};
export function createQrCamera(video:HTMLVideoElement,onResult:(raw:string)=>void):ScannerHandle{
 return new QrScanner(video,result=>onResult(result.data),{preferredCamera:'environment',returnDetailedScanResult:true,highlightScanRegion:true,highlightCodeOutline:true,maxScansPerSecond:6});
}
export function stopQrCamera(scanner:ScannerHandle|null,video:HTMLVideoElement|null){
 scanner?.stop();scanner?.destroy();
 const stream=video?.srcObject as MediaStream|null;
 stream?.getTracks().forEach(track=>track.stop());if(video)video.srcObject=null;
}
export function cameraError(error:unknown){return error instanceof DOMException&&error.name==='NotAllowedError'?'Camera permission was denied. Allow camera access or use the pairing-code fallback.':'Camera is unavailable. Use HTTPS and check permissions, or enter the pairing code.';}
