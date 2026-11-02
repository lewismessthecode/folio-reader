let socket=null,heartbeat=null;
const jobs=new Map();
const token='AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const articleFeatures={longform_notetweets_consumption_enabled:true,responsive_web_twitter_article_tweet_consumption_enabled:true,longform_notetweets_rich_text_read_enabled:true,longform_notetweets_inline_media_enabled:true,articles_preview_enabled:true,responsive_web_graphql_exclude_directive_enabled:true,verified_phone_label_enabled:false};
const toggles={withArticleRichContentState:true,withArticlePlainText:true};
function send(value){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(value));}
async function run(job,signal){
 const [csrf,auth,twid]=await Promise.all(['ct0','auth_token','twid'].map(name=>chrome.cookies.get({url:'https://x.com/',name})));
 if(!csrf?.value||!auth?.value||!twid?.value)throw new Error('请在当前 Chrome 用户配置中登录 X');
 const account=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(twid.value)))).map(n=>n.toString(16).padStart(2,'0')).join('');
 let op,id,variables,features,fields;
 if(job.op==='bookmarks'){
  if(job.cursor!==null&&typeof job.cursor!=='string')throw new Error('无效的收藏游标');
  op='Bookmarks';id='Fy0QMy4q_aZCpkO0PnyLYw';variables={count:50,includePromotedContent:false,...(job.cursor?{cursor:job.cursor}:{})};features=await fetch(chrome.runtime.getURL('bookmark-features.json')).then(r=>r.json());
 }else if(job.op==='article'){
  if(typeof job.tweetId!=='string'||!/^\d{1,30}$/.test(job.tweetId))throw new Error('无效的文章标识');
  op='TweetResultByRestId';id='7xflPyRiUxGVbJd4uWmbfg';variables={tweetId:job.tweetId,withCommunity:false,includePromotedContent:false,withVoice:false};features=articleFeatures;fields=toggles;
 }else throw new Error('不支持的请求');
 const params=new URLSearchParams({variables:JSON.stringify(variables),features:JSON.stringify(features)});if(fields)params.set('fieldToggles',JSON.stringify(fields));
 const response=await fetch(`https://x.com/i/api/graphql/${id}/${op}?${params}`,{credentials:'include',headers:{Authorization:'Bearer '+decodeURIComponent(token),'X-Csrf-Token':csrf.value,'X-Twitter-Auth-Type':'OAuth2Session','X-Twitter-Active-User':'yes'},signal});
 if(!response.ok)throw new Error(response.status===429?'X 暂时限制了请求次数，请稍后再试':response.status===401||response.status===403?'X 登录失效或不接受扩展请求，请检查登录':`X 接口返回 ${response.status}，可能需要更新 Folio`);
 const data=await response.json();if(Array.isArray(data.errors)&&data.errors.length)throw new Error('X 返回了错误，接口可能已更改');
 return {account,data};
}
function connect(code){return new Promise(resolve=>{
 const [port,secret]=code.split(':');if(!/^\d{2,5}$/.test(port)||Number(port)>65535||!/^[a-f0-9]{64}$/.test(secret))return resolve({ok:false,error:'配对码无效'});
 if(socket)socket.close();const ws=new WebSocket(`ws://127.0.0.1:${port}`);socket=ws;let settled=false;const timer=setTimeout(()=>{if(!settled){settled=true;ws.close();resolve({ok:false,error:'连接超时，请重新导入'})}},7000);
 ws.onopen=()=>ws.send(JSON.stringify({type:'auth',secret}));
 ws.onmessage=async event=>{let m;try{m=JSON.parse(event.data)}catch{return}if(m.type==='ready'){clearTimeout(timer);if(!settled){settled=true;resolve({ok:true})}clearInterval(heartbeat);heartbeat=setInterval(()=>send({type:'ping'}),20000);return}
  if(m.type==='cancel'&&typeof m.id==='string'){jobs.get(m.id)?.abort();return}
  if(m.type!=='request'||typeof m.id!=='string'||!['bookmarks','article'].includes(m.op))return;
  const controller=new AbortController();jobs.set(m.id,controller);
  try{const result=await run(m,controller.signal);send({type:'result',id:m.id,result})}catch(e){send({type:'result',id:m.id,error:e?.name==='AbortError'?'已暂停':String(e?.message||'读取失败')})}finally{jobs.delete(m.id)}
 };
 ws.onclose=()=>{clearInterval(heartbeat);for(const c of jobs.values())c.abort();jobs.clear();if(!settled){settled=true;clearTimeout(timer);resolve({ok:false,error:'连接失败，请确认 Folio 正在运行'})}};
 ws.onerror=()=>{if(!settled){settled=true;clearTimeout(timer);resolve({ok:false,error:'连接失败，请确认 Folio 正在运行'})}};
});}
chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{if(msg?.type==='connect'){connect(String(msg.code||'')).then(respond);return true}});
