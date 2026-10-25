import { BOARDS, api, getSettings } from './shared.js';

const $ = (id) => document.getElementById(id);
const isMac = /Mac/.test(navigator.platform || '');
const windowed = new URLSearchParams(location.search).has('window');
if (windowed) document.body.classList.add('windowed');

const state = {
  board: 'stocks',
  tags: [],
  tagDraft: '',
  highlight: 0,
  boardTags: {}, // board id -> [tags]
  source: { url: '', title: '' },
  saving: false,
};

// Same colors as the board's tag dots.
const tagHue = (tag) => {
  let hash = 0;
  for (let i = 0; i < tag.length; i += 1) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash) % 360;
};
const dot = (tag) => {
  const i = document.createElement('i');
  i.style.background = `hsl(${tagHue(tag)} 50% 52%)`;
  return i;
};
const normalizeTag = (value) => String(value || '').replace(/^#+/, '').trim();

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

/* ---------- draft (survives the popup closing by accident) ---------- */
function saveDraft() {
  chrome.storage.session.set({
    popupDraft: { content: $('content').value, tags: state.tags, board: state.board, withSource: $('withSource').checked, source: state.source },
  });
}

/* ---------- boards ---------- */
function renderBoards() {
  const box = $('boards');
  box.replaceChildren(...BOARDS.map((board) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.role = 'tab';
    b.textContent = board.label;
    b.setAttribute('aria-selected', String(board.id === state.board));
    b.addEventListener('click', () => {
      state.board = board.id;
      chrome.storage.local.set({ lastBoard: board.id });
      renderBoards();
      renderSuggest();
      saveDraft();
      $('content').focus();
    });
    return b;
  }));
}

/* ---------- tags ---------- */
function renderChips() {
  $('chips').replaceChildren(...state.tags.map((tag) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.append(dot(tag), document.createTextNode(tag));
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', `タグ「${tag}」を外す`);
    x.addEventListener('click', () => { removeTag(tag); $('tagInput').focus(); });
    chip.append(x);
    return chip;
  }));
  $('tagInput').placeholder = state.tags.length ? '＋タグ' : '＋タグを付ける';
}

function options() {
  const q = normalizeTag(state.tagDraft).toLowerCase();
  const known = state.boardTags[state.board] || [];
  const list = known.filter((tag) => !state.tags.includes(tag) && (!q || tag.toLowerCase().includes(q))).slice(0, 8);
  const draft = normalizeTag(state.tagDraft);
  if (draft && !known.includes(draft) && !state.tags.includes(draft)) list.push({ create: draft });
  return list;
}

function renderSuggest() {
  const ul = $('suggest');
  const open = document.activeElement === $('tagInput');
  const opts = open ? options() : [];
  ul.hidden = opts.length === 0;
  $('tagInput').setAttribute('aria-expanded', String(!ul.hidden));
  if (state.highlight >= opts.length) state.highlight = Math.max(0, opts.length - 1);
  ul.replaceChildren(...opts.map((option, index) => {
    const li = document.createElement('li');
    li.role = 'option';
    li.setAttribute('aria-selected', String(index === state.highlight));
    if (option.create) {
      li.className = 'create';
      li.textContent = `＋「${option.create}」を新しいタグとして追加`;
    } else {
      li.append(dot(option), document.createTextNode(option));
    }
    li.addEventListener('mousedown', (event) => event.preventDefault());
    li.addEventListener('mouseenter', () => { state.highlight = index; renderSuggest(); });
    li.addEventListener('click', () => addTag(option.create || option));
    return li;
  }));
}

function addTag(tag) {
  const value = normalizeTag(tag);
  if (!value || value.includes('/') || state.tags.includes(value)) return;
  state.tags.push(value);
  state.tagDraft = '';
  $('tagInput').value = '';
  state.highlight = 0;
  renderChips();
  renderSuggest();
  saveDraft();
}
function removeTag(tag) {
  state.tags = state.tags.filter((t) => t !== tag);
  renderChips();
  renderSuggest();
  saveDraft();
}

async function loadTags() {
  const { boardTags } = await chrome.storage.local.get('boardTags');
  if (boardTags?.boards) state.boardTags = boardTags.boards;
  renderSuggest();
  try {
    const { boards } = await api('GET');
    state.boardTags = Object.fromEntries(boards.map((b) => [b.id, b.tags]));
    chrome.storage.local.set({ boardTags: { at: Date.now(), boards: state.boardTags } });
    renderSuggest();
  } catch (error) {
    if (error.code === 'UNAUTHORIZED') setStatus('アクセスキーが違います。設定を確認してください', 'err');
  }
}

/* ---------- source / content ---------- */
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}
async function selectedText(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: () => String(window.getSelection?.() || '') });
    return result?.result || '';
  } catch {
    return '';
  }
}
function renderSource() {
  const has = Boolean(state.source.url);
  $('sourceRow').hidden = !has;
  $('sourceTitle').textContent = has ? `— ${state.source.title || state.source.url}` : '';
  $('sourceTitle').title = state.source.url;
}

function composedContent() {
  const text = $('content').value.trim();
  if (!$('withSource').checked || !state.source.url) return text;
  const link = [state.source.title, state.source.url].filter(Boolean).join('\n');
  if (!text) return link;
  return text.includes(state.source.url) ? text : `${text}\n\n${link}`;
}

function updateSaveButton() {
  $('save').disabled = state.saving || !composedContent();
}

/* ---------- save ---------- */
async function save() {
  const content = composedContent();
  if (!content || state.saving) return;
  const pendingTag = normalizeTag(state.tagDraft);
  if (pendingTag) addTag(pendingTag);
  state.saving = true;
  updateSaveButton();
  $('save').textContent = '保存中…';
  setStatus('');
  try {
    const withSource = $('withSource').checked && state.source.url;
    await api('POST', {
      board: state.board,
      content,
      tags: state.tags,
      ...(withSource ? { sourceUrl: state.source.url, sourceTitle: state.source.title } : {}),
    });
    await chrome.storage.session.remove('popupDraft');
    const label = BOARDS.find((b) => b.id === state.board)?.label;
    setStatus(`「${label}」に保存しました`, 'ok');
    $('save').textContent = '保存済み';
    setTimeout(() => window.close(), 900);
  } catch (error) {
    setStatus(error.message || '保存に失敗しました', 'err');
    $('save').textContent = '保存';
    state.saving = false;
    updateSaveButton();
  }
}

/* ---------- init ---------- */
async function init() {
  const { accessKey, baseUrl } = await getSettings();
  $('openBoard').addEventListener('click', (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: `${baseUrl}/boards?board=${state.board}` });
  });
  if (!accessKey) {
    $('app').hidden = true;
    $('setup').hidden = false;
    $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
    return;
  }

  const { lastBoard } = await chrome.storage.local.get('lastBoard');
  if (BOARDS.some((b) => b.id === lastBoard)) state.board = lastBoard;

  const { pendingCapture, popupDraft } = await chrome.storage.session.get(['pendingCapture', 'popupDraft']);
  if (pendingCapture && Date.now() - pendingCapture.at < 60_000) {
    // Opened from the right-click menu.
    await chrome.storage.session.remove('pendingCapture');
    $('content').value = pendingCapture.text || '';
    state.source = { url: pendingCapture.url, title: pendingCapture.title };
  } else if (popupDraft && (popupDraft.content || popupDraft.tags?.length)) {
    // Popup was closed before saving: restore what was typed.
    $('content').value = popupDraft.content || '';
    state.tags = popupDraft.tags || [];
    if (BOARDS.some((b) => b.id === popupDraft.board)) state.board = popupDraft.board;
    $('withSource').checked = popupDraft.withSource !== false;
    state.source = popupDraft.source || state.source;
  } else {
    const tab = await activeTab();
    if (tab && /^https?:/.test(tab.url || '')) {
      state.source = { url: tab.url, title: tab.title || '' };
      $('content').value = tab.id ? await selectedText(tab.id) : '';
    }
  }

  $('hint').textContent = isMac ? '⌘↵' : 'Ctrl+↵';
  renderBoards();
  renderChips();
  renderSource();
  updateSaveButton();

  const content = $('content');
  content.focus();
  content.setSelectionRange(content.value.length, content.value.length);
  content.addEventListener('input', () => { updateSaveButton(); saveDraft(); });
  $('withSource').addEventListener('change', () => { updateSaveButton(); saveDraft(); });

  const tagInput = $('tagInput');
  tagInput.addEventListener('input', () => { state.tagDraft = tagInput.value; state.highlight = 0; renderSuggest(); });
  tagInput.addEventListener('focus', renderSuggest);
  tagInput.addEventListener('blur', () => setTimeout(renderSuggest, 0));
  tagInput.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    const opts = options();
    if (event.key === 'ArrowDown') { event.preventDefault(); state.highlight = Math.min(state.highlight + 1, opts.length - 1); renderSuggest(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); state.highlight = Math.max(state.highlight - 1, 0); renderSuggest(); }
    else if ((event.key === 'Enter' && !(event.metaKey || event.ctrlKey)) || event.key === ',' || event.key === '、') {
      const pick = opts[state.highlight];
      if (pick || state.tagDraft) { event.preventDefault(); addTag(pick ? (pick.create || pick) : state.tagDraft); }
    } else if (event.key === 'Backspace' && !tagInput.value && state.tags.length) {
      removeTag(state.tags[state.tags.length - 1]);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); }
  });
  $('save').addEventListener('click', save);

  loadTags();
}

init();
