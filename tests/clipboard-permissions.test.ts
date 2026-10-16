import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyText} from '../lib/clipboard';

test('Copy reports success only after Clipboard API completion and propagates permission failures',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');let written='';
  try{
    Object.defineProperty(globalThis,'window',{value:{isSecureContext:true},configurable:true});
    Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async(text:string)=>{written=text;}}},configurable:true});
    await copyText('line one\nline two');assert.equal(written,'line one\nline two');
    Object.defineProperty(globalThis,'navigator',{value:{clipboard:{writeText:async()=>{throw new Error('Permission denied');}}},configurable:true});await assert.rejects(copyText('sample'),/Permission denied/);
    Object.defineProperty(globalThis,'navigator',{value:{},configurable:true});await assert.rejects(copyText('sample'),/supported browser/);
  }finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else Reflect.deleteProperty(globalThis,'navigator');if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else Reflect.deleteProperty(globalThis,'window');}
});
