document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const { m3u8Cache = {} } = await chrome.storage.local.get('m3u8Cache')
  const videos = m3u8Cache[tab.id] || []
  const list = document.getElementById('list')

  if (videos.length === 0) {
    list.innerHTML = '<div style="padding:40px;text-align:center;color:#999;font-size:13px;">请播放视频后嗅探</div>'
  } else {
    // 💡 倒序排列，因为正片通常在广告后面出现
    list.innerHTML = videos.reverse().map((v, i) => `
      <div style="padding:15px; border-bottom:1px solid #f0f0f0;">
        <div style="font-size:13px; font-weight:bold; margin-bottom:8px; color:#333;">
          ${i === 0 ? '✨ 疑似正片资源' : '资源 #' + (videos.length - i)}
        </div>
        <div style="display:flex; gap:10px;">
          <button class="btn" data-url="${v.url}" data-mode="fast" style="flex:1; background:#007aff; color:#fff; border:none; padding:8px; border-radius:6px; cursor:pointer; font-size:12px;">极速下载 (TS)</button>
          <button class="btn" data-url="${v.url}" data-mode="pro" style="flex:1; background:#5856d6; color:#fff; border:none; padding:8px; border-radius:6px; cursor:pointer; font-size:12px;">修复下载 (MP4)</button>
        </div>
      </div>
    `).join('')
  }

  document.querySelectorAll('.btn').forEach(btn => {
    btn.onclick = async () => {
      const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
      const newId = Date.now()
      downloadQueue.push({
        id: newId, url: btn.dataset.url, title: tab.title, tabId: tab.id,
        mode: btn.dataset.mode, status: 'pending', progress: 0, size: '0'
      })
      await chrome.storage.local.set({ downloadQueue })

      const managerUrl = chrome.runtime.getURL('download.html')
      const existingTabs = await chrome.tabs.query({ url: managerUrl + '*' })
      if (existingTabs.length > 0) {
        chrome.tabs.update(existingTabs[0].id, { active: true })
        chrome.tabs.sendMessage(existingTabs[0].id, { type: 'NEW_TASK', id: newId })
      } else {
        window.open(`download.html?autoId=${newId}`)
      }
    }
  })
})