import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import matter from 'gray-matter';
import {DatabaseSync} from 'node:sqlite';
import type {Article,Annotation,Draft} from '../src/types';
export const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const marker='\n<!-- folio-annotations -->';
const endMarker='<!-- /folio-annotation -->';
const notePattern=/<!-- annotation:([A-Za-z0-9+/=]+) -->\n([\s\S]*?)<!-- \/folio-annotation -->/g;
const dateString=(value:unknown)=>value instanceof Date?value.toISOString():String(value||'');
export class Library {
 private queue:Promise<unknown>=Promise.resolve();
 constructor(public root:string){}
 async init(){for(const p of ['articles','assets','knowledge/topics','knowledge/cards','.reader/snapshots'])await fs.mkdir(path.join(this.root,p),{recursive:true});}
 async files(dir=this.root):Promise<string[]>{const rows=await fs.readdir(dir,{withFileTypes:true});const out:string[]=[];for(const r of rows){if(r.name.startsWith('.'))continue;const p=path.join(dir,r.name);if(r.isSymbolicLink())continue;if(r.isDirectory())out.push(...await this.files(p));else if(r.name.endsWith('.md'))out.push(p);}return out;}
 private serial<T>(work:()=>Promise<T>):Promise<T>{const next=this.queue.then(work,work);this.queue=next.catch(()=>{});return next;}
 async read(file:string):Promise<Article>{const raw=await fs.readFile(file,'utf8');const {data:d,content}=matter(raw);const split=content.indexOf(marker);const body=split<0?content:content.slice(0,split);const notes=split<0?'':content.slice(split+marker.length);const annotations:Annotation[]=[];
 for(const m of notes.matchAll(notePattern)){try{const meta=JSON.parse(Buffer.from(m[1],'base64').toString());const [quotePart,textPart]=m[2].split('\n<!-- folio-comment -->\n');if(typeof meta.id==='string'&&textPart!==undefined)annotations.push({...meta,quote:quotePart.trim().split('\n').map(line=>line.replace(/^> ?/,'')).join('\n'),text:textPart.trim()});}catch{}}
 return {id:String(d.id||digest(body)),path:path.relative(this.root,file),title:String(d.title||path.basename(file,'.md')),author:String(d.author||''),url:String(d.url||''),published:dateString(d.published),imported:dateString(d.imported),topics:Array.isArray(d.topics)?d.topics.map(String):[],rating:Number(d.rating)||0,status:['未读','在读','已读','略过'].includes(d.status)?d.status:'未读',body:body.trim(),hash:digest(raw),kind:d.kind==='topic'||d.kind==='card'?d.kind:'article',annotations,suggestion:d.suggestion};}
 async list(){await this.init();const items:Article[]=[];for(const file of await this.files()){try{items.push(await this.read(file));}catch{}}const db=new DatabaseSync(path.join(this.root,'.reader/index.sqlite'));try{db.exec('CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, path TEXT, title TEXT, author TEXT, body TEXT); DELETE FROM articles;');const insert=db.prepare('INSERT OR REPLACE INTO articles VALUES (?,?,?,?,?)');for(const a of items)insert.run(a.id,a.path,a.title,a.author,a.body);}finally{db.close();}return items;}
 async find(id:string){const a=(await this.list()).find(a=>a.id===id);if(!a)throw new Error('文章不存在，请刷新资料库');return a;}
 async save(a:Article){return this.serial(()=>this.saveUnlocked(a));}
 private async saveUnlocked(a:Article){const current=await this.find(a.id);const file=path.join(this.root,current.path);const raw=await fs.readFile(file,'utf8');if(digest(raw)!==a.hash)throw new Error('文件已被其他程序修改。请刷新后重新编辑，当前修改尚未保存');const parsed=matter(raw);
 const oldTail=parsed.content.includes(marker)?parsed.content.slice(parsed.content.indexOf(marker)+marker.length):'';
 const knownBlocks=[...oldTail.matchAll(notePattern)];if(knownBlocks.length!==current.annotations.length)throw new Error('批注定位格式已被修改，请先在文件中检查批注，避免覆盖原有内容');
 const extras=oldTail.replace(notePattern,'').replace(/^\s*## 我的批注\s*/,'').trim();
 if(extras.includes('<!-- annotation:'))throw new Error('批注格式无法识别，请先检查文件，原有内容未改动');
 const d={...parsed.data,id:a.id,title:a.title,author:a.author,url:a.url,published:a.published,imported:a.imported,topics:a.topics,rating:Math.max(0,Math.min(5,a.rating)),status:a.status,kind:a.kind};
 let body=a.body;
 if(a.annotations.length||extras)body+=marker+'\n\n## 我的批注\n\n'+a.annotations.map(n=>{const {text,quote,...meta}=n;return '<!-- annotation:'+Buffer.from(JSON.stringify(meta)).toString('base64')+' -->\n\n> '+quote.replace(/\n/g,'\n> ')+'\n\n<!-- folio-comment -->\n'+text+'\n'+endMarker+'\n';}).join('\n')+(extras?'\n'+extras+'\n':'');
 const next=matter.stringify(body+'\n',d);await fs.writeFile(path.join(this.root,'.reader/snapshots',digest(raw)+'.md'),raw,{flag:'wx'}).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='EEXIST')throw e;});const tmp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,next);if(digest(await fs.readFile(file,'utf8'))!==a.hash){await fs.rename(tmp,file+'.conflict-'+Date.now()+'.md');throw new Error('保存时检测到外部修改，已保留冲突副本');}await fs.rename(tmp,file);return this.read(file);}
 async annotate(id:string,quote:string,text:string,hash:string){return this.serial(async()=>{const a=await this.find(id);if(a.hash!==hash)throw new Error('文章已更新，请重新选择原文');if(!quote.trim()||!text.trim())throw new Error('请选择原文并填写批注');if(quote.length>50000||text.length>50000)throw new Error('批注内容过长');a.annotations.push({id:randomUUID(),quote,text,created:new Date().toISOString(),sourceHash:digest(a.body)});return this.saveUnlocked(a);});}
 async importMarkdown(raw:string,filename:string,meta:Record<string,unknown>={}){return this.serial(async()=>{await this.init();const parsed=matter(raw);const identity=String(meta.id||parsed.data.id||digest(raw));if((await this.list()).some(a=>a.id===identity))return false;const d={...parsed.data,...meta,id:identity,title:meta.title||parsed.data.title||path.basename(filename,'.md'),imported:new Date().toISOString(),status:'未读',rating:0,topics:parsed.data.topics||[],kind:meta.kind||'article'};const dest=path.join(this.root,d.kind==='article'?'articles':`knowledge/${d.kind==='card'?'cards':'topics'}`,identity.replace(/[^a-zA-Z0-9_-]/g,'_')+'.md');await fs.writeFile(dest,matter.stringify(parsed.content,d),{flag:'wx'});return true;});}
 async saveDrafts(drafts:Draft[]){for(const d of drafts){await this.importMarkdown(d.body,d.title+'.md',{id:d.id,title:d.title,kind:d.kind,sources:d.sources});}}
}
