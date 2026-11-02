import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyze, parseAnalysis } from '../electron/services';
import { Library } from '../electron/library';
import type { Article, Settings } from '../src/types';

const article: Article = {id:'x-1',path:'articles/x-1.md',title:'Source',author:'Writer',url:'',published:'2023-01-01',imported:'',topics:['Original'],rating:4,status:'在读',body:'Actual source text',hash:'hash',kind:'article',annotations:[{id:'n1',quote:'Actual',text:'Private annotation',created:'',sourceHash:''}]};
const result = {suggestions:[{id:'x-1',topics:['Original','Design'],recommendation:'read',reason:'Detailed source'}],drafts:[{title:'Key idea',kind:'card',body:'Actual source text',sources:['x-1']}]};
const settings: Settings = {provider:'anthropic',model:'claude-sonnet-5-5',hasKey:true,vault:'',library:''};

test('returns reviewable recommendations and cards tied to existing articles', () => {
  const parsed = parseAnalysis(result, [article], 'en');
  assert.deepEqual(parsed.suggestions, result.suggestions);
  assert.equal(parsed.drafts[0].kind, 'card');
  assert.match(parsed.drafts[0].body, /First|Actual/);
  assert.match(parsed.drafts[0].body, /\n\n## Sources\n\n/);
  assert.match(parsed.drafts[0].body, /\[Source\]\(\.\.\/\.\.\/articles\/x-1\.md\)/);
  assert.throws(() => parseAnalysis({...result, suggestions:[{...result.suggestions[0],id:'unknown'}]}, [article]));
  assert.throws(() => parseAnalysis({...result, drafts:[{...result.drafts[0],sources:['unknown']}]}, [article]));
  assert.throws(() => parseAnalysis({...result, suggestions:[]}, [article]));
});

test('sends annotations only with explicit opt-in and reads provider output', async () => {
  const previousFetch = globalThis.fetch;
  const requests: Array<{url:string;body:any}> = [];
  globalThis.fetch = async (url, options) => {
    requests.push({url:String(url),body:JSON.parse(String(options?.body))});
    return new Response(JSON.stringify({content:[{type:'text',text:'```json\n'+JSON.stringify(result)+'\n```'}]}), {status:200});
  };
  try {
    const data = await analyze([article], settings, 'key', false, '', 'en');
    assert.equal(data.suggestions[0].id, article.id);
    assert.doesNotMatch(JSON.stringify(requests[0].body), /Private annotation/);
    assert.match(requests[0].body.system, /English/);
    await analyze([article], settings, 'key', true, '');
    assert.match(JSON.stringify(requests[1].body), /Private annotation/);
    assert.equal(requests[0].url, 'https://api.anthropic.com/v1/messages');
  } finally { globalThis.fetch = previousFetch; }
});

test('saving reviewed suggestions preserves notes, original topics and rating', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'folio-recommendation-'));
  try {
    const library = new Library(dir);
    await library.importMarkdown('---\ntopics:\n  - Original\n---\nOriginal passage', 'source.md', {id:'x-1'});
    let a = await library.find('x-1');
    a = await library.annotate(a.id, 'Original passage', 'My note', a.hash);
    a.rating = 4;
    a = await library.save(a);
    await library.save({...a, topics:[...a.topics,'Design'], recommendation:'read', suggestion:'Detailed source'});
    const reloaded = await library.find('x-1');
    assert.deepEqual(reloaded.topics, ['Original','Design']);
    assert.equal(reloaded.recommendation, 'read');
    assert.equal(reloaded.suggestion, 'Detailed source');
    assert.equal(reloaded.rating, 4);
    assert.equal(reloaded.annotations[0].text, 'My note');
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
