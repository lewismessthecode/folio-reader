const en=!chrome.i18n.getUILanguage().toLowerCase().startsWith('zh');
const text=(zh,enText)=>en?enText:zh;
const input=document.getElementById('code'),status=document.getElementById('status');
document.getElementById('instructions').textContent=text('在 Folio 开始导入，复制显示的配对码，粘贴到这里。请确认此 Chrome 用户已登录 X。','Start an import in Folio and paste the pairing code here. Make sure this Chrome profile is signed in to X.');
input.placeholder=text('配对码','Pairing code');document.getElementById('connect').textContent=text('连接','Connect');
document.getElementById('connect').addEventListener('click',async()=>{const code=input.value.trim();if(!/^\d{2,5}:[a-f0-9]{64}$/.test(code)){status.textContent=text('配对码无效','Invalid pairing code');return;}status.textContent=text('正在连接','Connecting');try{const result=await chrome.runtime.sendMessage({type:'connect',code});status.textContent=result.ok?text('已连接，可以返回 Folio','Connected. Return to Folio.'):text('连接失败，请确认 Folio 正在运行','Connection failed. Make sure Folio is running.');input.value='';}catch{status.textContent=text('连接失败，请确认 Folio 正在运行','Connection failed. Make sure Folio is running.');}});
