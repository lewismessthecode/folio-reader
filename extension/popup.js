const en = !chrome.i18n.getUILanguage().toLowerCase().startsWith('zh');
const text = (zh, english) => en ? english : zh;
document.documentElement.lang = en ? 'en' : 'zh-CN';
const input = document.getElementById('code');
const status = document.getElementById('status');
const button = document.getElementById('connect');
document.getElementById('eyebrow').textContent = text('浏览器扩展', 'Browser extension');
document.getElementById('title').textContent = text('连接到 Folio', 'Connect to Folio');
document.getElementById('instructions').textContent = text('在 Folio 中开始导入，复制配对码并粘贴到这里。', 'Start an import in Folio, then paste the pairing code here.');
document.getElementById('code-label').textContent = text('配对码', 'Pairing code');
document.getElementById('footer').textContent = text('请使用已登录 X 的 Chrome 用户。', 'Use the Chrome profile signed in to X.');
input.placeholder = text('粘贴配对码', 'Paste pairing code');
button.textContent = text('连接', 'Connect');
function showStatus(state, message) {
 status.dataset.state = state;
 status.textContent = message;
 input.setAttribute('aria-invalid', String(state === 'error'));
}
chrome.runtime.sendMessage({type:'status'}).then(result => {if(result?.connected)showStatus('success', text('已连接到 Folio。', 'Connected to Folio.'))}).catch(() => {});
input.addEventListener('input', () => {
 if (status.dataset.state === 'error') showStatus('', '');
});
document.getElementById('form').addEventListener('submit', async event => {
 event.preventDefault();
 const code = input.value.trim();
 if (!/^\d{2,5}:[a-f0-9]{64}$/.test(code) || Number(code.split(':')[0]) > 65535) {
  showStatus('error', text('配对码不正确，请从 Folio 重新复制。', 'Check the code and copy it again from Folio.'));
  input.focus();
  return;
 }
 button.disabled = true;
 input.disabled = true;
 button.textContent = text('正在连接', 'Connecting');
 showStatus('connecting', text('正在连接 Folio', 'Connecting to Folio'));
 try {
  const result = await chrome.runtime.sendMessage({type:'connect', code});
  if (!result?.ok) throw new Error('Connection failed');
  input.value = '';
  showStatus('success', text('已连接。返回 Folio 继续导入。', 'Connected. Return to Folio to continue.'));
 } catch {
  showStatus('error', text('无法连接。请确认 Folio 正在运行，并重新复制配对码。', 'Could not connect. Check that Folio is open and copy a new code.'));
 } finally {
  input.disabled = false;
  button.disabled = false;
  button.textContent = text('连接', 'Connect');
 }
});
