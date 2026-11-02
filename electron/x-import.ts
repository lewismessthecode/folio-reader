import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import {WebSocketServer,WebSocket} from 'ws';

export const EXTENSION_ID='goebcmbhigcpjhjcahhbjhmpgikllcfe';
type RecordValue=Record<string,any>;
export type Candidate={id:string;author:string;published:string};
export function parseBookmarks(payload:unknown):{items:Candidate[];next:string|null;scanned:number}{
 const data=payload as RecordValue;const instructions=data?.data?.bookmark_timeline_v2?.timeline?.instructions??data?.data?.bookmark_timeline?.timeline?.instructions;
 if(!Array.isArray(instructions))throw new Error('X 收藏数据格式已变化，未修改现有资料');
 const items:Candidate[]=[];let next:string|null=null,scanned=0;
 const take=(raw:any)=>{if(!raw)return;const tw=raw.tweet??raw;if(typeof tw.rest_id!=='string'||!/^\d{1,30}$/.test(tw.rest_id))return;scanned++;
  const article=tw.article?.article_results?.result;
  const urls=Array.isArray(tw.legacy?.entities?.urls)?tw.legacy.entities.urls:[];
  const confirmed=(article&&typeof article==='object'&&Boolean(article.rest_id||article.id||article.title||article.content_state))||urls.some((u:any)=>typeof u?.expanded_url==='string'&&/^https:\/\/(?:x\.com|twitter\.com)\/i\/article\/\d+(?:[/?#]|$)/.test(u.expanded_url));
  if(!confirmed)return;
  const author=tw.core?.user_results?.result?.legacy?.screen_name??tw.core?.user_results?.result?.core?.screen_name??'';
  if(!/^[A-Za-z0-9_]{1,15}$/.test(author))return;
  items.push({id:tw.rest_id,author,published:String(tw.legacy?.created_at??'')});
 };
 for(const instruction of instructions){for(const entry of instruction.entries??[]){const c=entry.content;if(!c)continue;if(c.cursorType==='Bottom'||c.cursorType==='ShowMore'||entry.entryId?.startsWith('cursor-bottom-')||entry.entryId?.startsWith('cursor-showMore-')){const v=c.value??c.itemContent?.value;if(typeof v==='string'&&v)next=v;continue;}if(c.itemContent?.tweet_results?.result)take(c.itemContent.tweet_results.result);else for(const nested of c.items??[])take(nested.item?.itemContent?.tweet_results?.result);}}
 return {items,next,scanned};
}
export function parseArticle(payload:unknown,candidate:Candidate):{title:string;body:string;url:string}{
 const data=payload as RecordValue;const result=data?.data?.tweetResult?.result;const tw=result?.tweet??result;
 if(tw?.rest_id!==candidate.id)throw new Error('X 返回的文章与请求不匹配');const article=tw?.article?.article_results?.result;
 if(!article||!Array.isArray(article.content_state?.blocks)||article.content_state.blocks.length===0)throw new Error('文章正文不可用');
 const entities=article.content_state.entityMap??{};const entityMap=new Map<string,any>(Array.isArray(entities)?entities.map((v:any)=>[String(v.key),v.value]):Object.entries(entities));
 const media=new Map<string,string>();for(const value of Object.values(article.media_entities??{}) as any[]){if(typeof value?.media_info?.original_img_url==='string')media.set(String(value.media_id),value.media_info.original_img_url);}
 const blocks:string[]=[];let ordered=0;
 for(const b of article.content_state.blocks){if(!b||typeof b!=='object')continue;if(b.type==='atomic'){const entity=entityMap.get(String(b.entityRanges?.[0]?.key));for(const item of entity?.data?.mediaItems??[]){const u=media.get(String(item?.mediaId));if(u)blocks.push(`![Image](${u})`);}continue;}
  const text=String(b.text??'');if(!text)continue;if(b.type!=='ordered-list-item')ordered=0;
  switch(b.type){case 'header-one':blocks.push('# '+text);break;case 'header-two':blocks.push('## '+text);break;case 'header-three':blocks.push('### '+text);break;case 'blockquote':blocks.push(text.split('\n').map((line:string)=>'> '+line).join('\n'));break;case 'unordered-list-item':blocks.push('- '+text);break;case 'ordered-list-item':blocks.push(`${++ordered}. ${text}`);break;case 'code-block':blocks.push('```\n'+text+'\n```');break;default:blocks.push(text);}}
 if(!blocks.length)throw new Error('文章正文为空');return {title:String(article.title||'Untitled'),body:blocks.join('\n\n'),url:`https://x.com/${candidate.author}/status/${candidate.id}`};
}
export class XBridge {
 private server:Server|null=null;private wss:WebSocketServer|null=null;private socket:WebSocket|null=null;private secret=randomBytes(32).toString('hex');private pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();private waiting=new Set<()=>void>();
 async listen():Promise<string>{if(!this.server){this.server=createServer((_req,res)=>{res.writeHead(404);res.end()});this.wss=new WebSocketServer({server:this.server,maxPayload:16*1024*1024,verifyClient:({origin}:{origin:string})=>origin===`chrome-extension://${EXTENSION_ID}`});this.wss.on('connection',socket=>this.accept(socket));await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(0,'127.0.0.1',()=>resolve())});}const addr=this.server.address();if(!addr||typeof addr==='string')throw new Error('无法启动本地连接');return `${addr.port}:${this.secret}`;}
 private accept(socket:WebSocket){let authorized=false;const timeout=setTimeout(()=>{if(!authorized)socket.close()},5000);socket.on('message',bytes=>{let m:any;try{m=JSON.parse(bytes.toString())}catch{return}if(!authorized){if(m?.type!=='auth'||typeof m.secret!=='string'||!/^[a-f0-9]{64}$/.test(m.secret)||!timingSafeEqual(Buffer.from(m.secret,'hex'),Buffer.from(this.secret,'hex'))){socket.close();return}if(this.socket&&this.socket.readyState===WebSocket.OPEN){socket.close();return}authorized=true;clearTimeout(timeout);this.socket=socket;socket.send(JSON.stringify({type:'ready'}));for(const wake of this.waiting)wake();return;}if(m?.type==='result'&&typeof m.id==='string'){const item=this.pending.get(m.id);if(!item)return;this.pending.delete(m.id);clearTimeout(item.timer);if(typeof m.error==='string')item.reject(new Error(m.error.slice(0,200)));else item.resolve(m.result);}});socket.on('close',()=>{clearTimeout(timeout);if(this.socket!==socket)return;this.socket=null;for(const [,p]of this.pending){clearTimeout(p.timer);p.reject(new Error('浏览器扩展已断开'))}this.pending.clear()});}
 async waitForConnection(signal:AbortSignal){if(this.socket?.readyState===WebSocket.OPEN)return;await new Promise<void>((resolve,reject)=>{const cleanup=()=>{this.waiting.delete(wake);signal.removeEventListener('abort',abort);clearTimeout(timer)};const wake=()=>{cleanup();resolve()};const abort=()=>{cleanup();reject(new Error('已暂停'))};const timer=setTimeout(()=>{cleanup();reject(new Error('等待浏览器扩展连接超时'))},120000);this.waiting.add(wake);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort()});}
 async request(op:'bookmarks'|'article'|'unbookmark',fields:Record<string,unknown>,signal:AbortSignal):Promise<{account:string;data:unknown}>{if(signal.aborted)throw new Error('已暂停');await this.waitForConnection(signal);const id=randomUUID();const socket=this.socket!;return new Promise((resolve,reject)=>{const cleanup=()=>signal.removeEventListener('abort',cancel);const timer=setTimeout(()=>{this.pending.delete(id);cleanup();reject(new Error('X 请求超时'))},60000);const cancel=()=>{socket.send(JSON.stringify({type:'cancel',id}));clearTimeout(timer);const fallback=setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);socket.close();cleanup();reject(new Error('已暂停'))}},5000);const item=this.pending.get(id);if(item){const originalResolve=item.resolve,originalReject=item.reject;item.resolve=(value)=>{clearTimeout(fallback);originalResolve(value)};item.reject=(error)=>{clearTimeout(fallback);originalReject(error)}}};this.pending.set(id,{resolve:(v)=>{cleanup();resolve(v)},reject:(e)=>{cleanup();reject(e)},timer});signal.addEventListener('abort',cancel,{once:true});if(signal.aborted){cancel();return}socket.send(JSON.stringify({type:'request',id,op,...fields}));});}
 get connected(){return this.socket?.readyState===WebSocket.OPEN}
 close(){this.socket?.close();this.wss?.close();this.server?.close();}
}
