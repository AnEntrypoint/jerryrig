let capturing = false

async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument()
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Capture tab audio and stream PCM to WebSocket'
    })
  }
}

async function startCapture(wsUrl, tabId) {
  await ensureOffscreen()
  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
      else resolve(id)
    })
  })
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_START', streamId, wsUrl })
  capturing = true
}

async function stopCapture() {
  const existing = await chrome.offscreen.hasDocument()
  if (existing) {
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' })
    await chrome.offscreen.closeDocument()
  }
  capturing = false
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (!tabId) { sendResponse({ ok: false, error: 'no active tab' }); return }
      startCapture(msg.wsUrl, tabId)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e.message }))
    })
    return true
  }
  if (msg.type === 'STOP') {
    stopCapture().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: e.message }))
    return true
  }
  if (msg.type === 'STATUS') {
    sendResponse({ capturing })
    return false
  }
})
