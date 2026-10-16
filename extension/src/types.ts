declare global {
  const __SUPABASE_URL__: string;
  const __SUPABASE_KEY__: string;
  const __APP_ORIGIN__: string;
}
export type ExtensionSettings={enabled:boolean;paused:boolean;poll:boolean;write:boolean;deviceId:string;peerId:string;name:string;appOrigin:string};
export const defaults:ExtensionSettings={enabled:false,paused:false,poll:false,write:false,deviceId:'',peerId:'',name:'My PC extension',appOrigin:__APP_ORIGIN__};
export type Command={target:'worker'|'offscreen';action:string;[key:string]:unknown};
export type ExtensionResponse={ok:boolean;error?:string;state?:ExtensionState;value?:unknown};
export type ExtensionState={signedIn:boolean;email:string;status:string;detail:string;settings:ExtensionSettings;devices:{id:string;name:string;platform:string;revoked:boolean}[];pairCode:string;pairExpires:string;pairMode:'create'|'join'|'';lastReceipt:string;clipboardError:string;relayConfigured:boolean|null};
