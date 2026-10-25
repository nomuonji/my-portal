// Right-click → "My Portal に保存" opens the save popup prefilled with the selection / link / page.
const MENU_ID = 'portal-save';

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'My Portal に保存',
    contexts: ['selection', 'page', 'link', 'image'],
  });
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});

async function selectionWithLineBreaks(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => String(window.getSelection?.() || ''),
    });
    return result?.result || '';
  } catch {
    return ''; // chrome:// pages, PDFs, etc.
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  let text = '';
  if (info.selectionText) text = (tab?.id ? await selectionWithLineBreaks(tab.id) : '') || info.selectionText;
  else if (info.linkUrl) text = info.linkUrl;
  else if (info.srcUrl) text = info.srcUrl;

  await chrome.storage.session.set({
    pendingCapture: { text, url: tab?.url || '', title: tab?.title || '', at: Date.now() },
  });

  try {
    await chrome.action.openPopup();
  } catch {
    // Older Chrome or no focused window: open the same UI in a small window.
    await chrome.windows.create({ url: 'popup.html?window=1', type: 'popup', width: 440, height: 600 });
  }
});
