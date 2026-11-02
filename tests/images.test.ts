import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {downloadArticleImages,mergeArticleImages} from '../electron/images';

test('downloads allowed images into the library and keeps failure visible',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'folio-images-'));
 try {
  const body='Text\n\n![one](https://pbs.twimg.com/media/a.jpg)\n\n![bad](https://example.com/x.png)';
  const fetchImage:typeof fetch=async()=>new Response(Uint8Array.from([1,2,3]),{headers:{'content-type':'image/jpeg'}});
  const result=await downloadArticleImages(root,'123',body,new AbortController().signal,fetchImage);
  assert.equal(result.missing,1);const match=result.body.match(/!\[one\]\(\.\.\/assets\/([^)]+)\)/);assert.ok(match);
  assert.deepEqual(await readFile(path.join(root,'assets',match[1])),Buffer.from([1,2,3]));
  assert.match(result.body,/https:\/\/example.com/);
 } finally {await rm(root,{recursive:true,force:true})}
});
test('restores images near matching paragraphs without replacing edits or duplicating images',()=>{
 const original='Intro\n\nA reader’s own edit\n\nNext paragraph\n\nConclusion';
 const source='Intro\n\n![Image](../assets/a.jpg)\n\nNext paragraph\n\nConclusion';
 const first=mergeArticleImages(original,source);
 assert.equal(first.added,1);assert.match(first.body,/Intro\n\n!\[Image\]/);assert.match(first.body,/A reader’s own edit/);
 assert.equal(mergeArticleImages(first.body,source).added,0);
 assert.equal(mergeArticleImages('Unrelated text',source).added,0);
});
