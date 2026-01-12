chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url
    const adKeywords = /ads|log|stat|telemetry|doubleclick|baidu|share/i
    if (adKeywords.test(url)) return

    if (url.includes(".m3u8") && !url.includes(".ts") && details.tabId !== -1) {
      chrome.storage.local.get(['m3u8Cache'], (data) => {
        let cache = data.m3u8Cache || {}
        if (!cache[details.tabId]) cache[details.tabId] = []

        if (!cache[details.tabId].some(v => v.url === url)) {
          cache[details.tabId].push({ url, time: Date.now() })
          chrome.storage.local.set({ m3u8Cache: cache })
          chrome.action.setBadgeText({ tabId: details.tabId, text: cache[details.tabId].length.toString() })
        }
      })
    }
  },
  { urls: ["<all_urls>"] }
)