const btn = document.getElementById('btn')
const urlInput = document.getElementById('wsUrl')
const statusEl = document.getElementById('status')

let capturing = false

function setUI(isCapturing) {
  capturing = isCapturing
  btn.textContent = isCapturing ? 'Stop' : 'Start'
  statusEl.textContent = isCapturing ? 'Capturing...' : 'Idle'
}

chrome.storage.local.get(['wsUrl'], (result) => {
  urlInput.value = result.wsUrl || 'ws://127.0.0.1:9888'
})

chrome.runtime.sendMessage({ type: 'STATUS' }, (res) => {
  if (res) setUI(res.capturing)
})

btn.addEventListener('click', () => {
  const wsUrl = urlInput.value.trim() || 'ws://127.0.0.1:9888'
  chrome.storage.local.set({ wsUrl })

  if (!capturing) {
    statusEl.textContent = 'Starting...'
    chrome.runtime.sendMessage({ type: 'START', wsUrl }, (res) => {
      if (res?.ok) {
        setUI(true)
      } else {
        statusEl.textContent = 'Error: ' + (res?.error || 'unknown')
      }
    })
  } else {
    statusEl.textContent = 'Stopping...'
    chrome.runtime.sendMessage({ type: 'STOP' }, (res) => {
      if (res?.ok) setUI(false)
      else statusEl.textContent = 'Error: ' + (res?.error || 'unknown')
    })
  }
})
