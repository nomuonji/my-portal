// Shared helpers for popup / options.
export const DEFAULT_BASE_URL = 'https://my-portal-agent.netlify.app';

export const BOARDS = [
  { id: 'stocks', label: 'ネタ・表現' },
  { id: 'ideas', label: '企画・ビジネス' },
  { id: 'hobbies', label: '興味・趣味' },
];

export async function getSettings() {
  const { accessKey = '', baseUrl = DEFAULT_BASE_URL } = await chrome.storage.local.get(['accessKey', 'baseUrl']);
  return { accessKey, baseUrl: (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '') };
}

export async function api(method, body) {
  const { accessKey, baseUrl } = await getSettings();
  if (!accessKey) throw Object.assign(new Error('アクセスキーが未設定です'), { code: 'NO_KEY' });
  const response = await fetch(`${baseUrl}/api/board-capture`, {
    method,
    headers: { Authorization: `Bearer ${accessKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) throw Object.assign(new Error('アクセスキーが違います'), { code: 'UNAUTHORIZED' });
  if (!response.ok) throw new Error(payload.error || `保存に失敗しました (${response.status})`);
  return payload;
}
