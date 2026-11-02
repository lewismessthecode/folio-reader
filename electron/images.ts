import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const imagePattern = /!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g;
const extensions:Record<string,string> = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif'};
const maxImageBytes = 20 * 1024 * 1024;

export async function downloadArticleImages(root:string, articleId:string, markdown:string, signal:AbortSignal, fetchImage:typeof fetch=fetch):Promise<{body:string;missing:number}> {
 let body=markdown,missing=0;
 for(const match of markdown.matchAll(imagePattern)) {
  if(signal.aborted)break;
  try {
   const url=new URL(match[2]);
   if(url.protocol!=='https:' || !['pbs.twimg.com','abs.twimg.com'].includes(url.hostname) || url.username || url.password || url.port)throw new Error('unsupported image');
   const response=await fetchImage(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),redirect:'error'});
   const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
   const extension=extensions[mime];
   if(!response.ok || !extension || !response.body)throw new Error('image unavailable');
   const declared=Number(response.headers.get('content-length'));
   if(Number.isFinite(declared) && declared>maxImageBytes)throw new Error('image too large');
   const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
   try {
    while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>maxImageBytes)throw new Error('image too large');chunks.push(chunk.value);}
   } catch(error) {await reader.cancel().catch(()=>{});throw error;}
   const hash=createHash('sha256').update(url.href).digest('hex').slice(0,20);
   const name=`${articleId.replace(/[^a-zA-Z0-9_-]/g,'_')}-${hash}.${extension}`;
   await fs.mkdir(path.join(root,'assets'),{recursive:true});
   await fs.writeFile(path.join(root,'assets',name),Buffer.concat(chunks));
   body=body.replace(match[0],`![${match[1]}](../assets/${name})`);
  } catch {if(signal.aborted)break;missing++;}
 }
 return {body,missing};
}

const imageBlock=(value:string)=>/^\s*!\[[^\]]*\]\(\.\.\/assets\/[^)]+\)\s*$/.test(value);
const containsImage=(value:string)=>/!\[[^\]]*\]\([^)]+\)/.test(value);
function textKey(value:string):string {
 return value.replace(/!\[[^\]]*\]\([^)]+\)/g,'').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/^[\s>#*\-+\d.]+/gm,'').replace(/[`*_~]/g,'').replace(/\s+/g,' ').trim();
}

/** Insert source images beside matching text while retaining the stored Markdown. */
export function mergeArticleImages(original:string,source:string):{body:string;added:number} {
 const old=original.split(/\n\s*\n/), fresh=source.split(/\n\s*\n/);
 let added=0;
 for(let i=0;i<fresh.length;i++){
  if(!imageBlock(fresh[i]))continue;
  const group:string[]=[];while(i<fresh.length && imageBlock(fresh[i]))group.push(fresh[i++]);
  const before=[...fresh.slice(0,i-group.length)].reverse().map(textKey).find(Boolean);
  const after=fresh.slice(i).map(textKey).find(Boolean);
  const beforeMatches=before?old.flatMap((p,index)=>textKey(p)===before?[index]:[]):[];
  const beforeIndex=beforeMatches.length===1?beforeMatches[0]:-1;
  const afterMatches=after?old.flatMap((p,index)=>index>beforeIndex&&textKey(p)===after?[index]:[]):[];
  const afterIndex=afterMatches.length===1?afterMatches[0]:-1;
  if(beforeMatches.length>1 || afterMatches.length>1){i--;continue;}
  if(beforeIndex<0 && afterIndex<0){i--;continue;}
  const start=beforeIndex>=0?beforeIndex+1:0;
  const end=afterIndex>=0?afterIndex:Math.min(old.length,start+1);
  if(old.slice(start,end).some(containsImage)){i--;continue;}
  old.splice(start,0,...group);added+=group.length;i--;
 }
 return {body:added?old.join('\n\n'):original,added};
}
