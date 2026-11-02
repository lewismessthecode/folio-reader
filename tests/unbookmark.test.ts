import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';

test('unbookmark sends one constrained X mutation only for the matching account',async()=>{
 const account=createHash('sha256').update('u=123').digest('hex');
 const calls:{url:string;options:RequestInit}[]=[];
 const source=await readFile(new URL('../extension/worker.js',import.meta.url),'utf8');
 const context=vm.createContext({
  chrome:{cookies:{get:async({name}:{name:string})=>({value:name==='twid'?'u=123':'value'})},runtime:{onMessage:{addListener(){}}}},
  crypto:webcrypto,TextEncoder,URLSearchParams,AbortController,WebSocket:class{},setTimeout,clearTimeout,setInterval,clearInterval,
  fetch:async(url:string,options:RequestInit)=>{calls.push({url,options});return {ok:true,json:async()=>({data:{tweet_bookmark_delete:'Done'}})}},
 });
 vm.runInContext(source+'\nglobalThis.runForTest=run',context);
 const run=context.runForTest as (job:unknown,signal:AbortSignal)=>Promise<{data:{data:{tweet_bookmark_delete:string}}}>;
 const signal=new AbortController().signal;
 await assert.rejects(run({op:'unbookmark',tweetId:'123',expectedAccount:'0'.repeat(64)},signal),/账号/);
 await assert.rejects(run({op:'unbookmark',tweetId:'../123',expectedAccount:account},signal),/标识/);
 assert.equal(calls.length,0);
 const result=await run({op:'unbookmark',tweetId:'123',expectedAccount:account},signal);
 assert.equal(result.data.data.tweet_bookmark_delete,'Done');
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://x.com/i/api/graphql/Wlmlj2-xzyS1GN3a6cj-mQ/DeleteBookmark');
 assert.equal(calls[0].options.method,'POST');
 assert.deepEqual(JSON.parse(String(calls[0].options.body)),{variables:{tweet_id:'123'},queryId:'Wlmlj2-xzyS1GN3a6cj-mQ'});
});
