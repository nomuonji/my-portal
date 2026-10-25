import { DEFAULT_BASE_URL, api } from './shared.js';

const $ = (id) => document.getElementById(id);

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = `status ${kind}`;
}

async function init() {
  const { accessKey = '', baseUrl = DEFAULT_BASE_URL } = await chrome.storage.local.get(['accessKey', 'baseUrl']);
  $('accessKey').value = accessKey;
  $('baseUrl').value = baseUrl;
  $('saveBtn').addEventListener('click', async () => {
    const key = $('accessKey').value.trim();
    let url = ($('baseUrl').value.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
    if (!/^https:\/\//.test(url)) url = DEFAULT_BASE_URL;
    await chrome.storage.local.set({ accessKey: key, baseUrl: url });
    if (!key) { setStatus('アクセスキーを入力してください', 'err'); return; }
    setStatus('接続テスト中…');
    try {
      const { boards } = await api('GET');
      await chrome.storage.local.set({ boardTags: { at: Date.now(), boards: Object.fromEntries(boards.map((b) => [b.id, b.tags])) } });
      setStatus('接続できました', 'ok');
    } catch (error) {
      setStatus(error.message || '接続できませんでした', 'err');
    }
  });
}

init();
