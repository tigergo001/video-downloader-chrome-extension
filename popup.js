document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const { m3u8Cache = {} } = await chrome.storage.local.get('m3u8Cache')
  let videos = m3u8Cache[tab.id] || []
  const list = document.getElementById('list')

  const renderList = () => {
    // 1. 过滤逻辑：只保留正片疑似资源，排除包含广告关键字的链接
    const filtered = videos.filter(v => !/adslot|advert|doubleclick|\.ts$/i.test(v.url))

    if (filtered.length === 0) {
      list.innerHTML = '<div style="padding:40px;text-align:center;color:#999;font-size:13px;">暂无有效视频资源</div>'
      return
    }

    list.innerHTML = filtered.reverse().map((v, i) => `
      <div class="card" style="padding:12px; border-bottom:1px solid #f0f0f0;">
        <div style="font-size:12px; font-weight:600; margin-bottom:8px; color:#333; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          ${i === 0 ? '✨ 疑似正片：' : '资源：'}${tab.title}
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-pro" data-url="${v.url}" style="flex:1; background:#5856d6; color:#fff; border:none; padding:8px; border-radius:6px; cursor:pointer; font-size:12px;">极速下载 (MP4)</button>
          <button class="btn-del" data-url="${v.url}" style="width:50px; background:#ff3b30; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:12px;">删除</button>
        </div>
      </div>
    `).join('')

    // 绑定极速下载事件
    document.querySelectorAll('.btn-pro').forEach(btn => {
      btn.onclick = async () => {
        const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
        const newId = Date.now()
        downloadQueue.push({
          id: newId, url: btn.dataset.url, title: tab.title,
          mode: 'pro', status: 'pending', progress: 0, size: '0'
        })
        await chrome.storage.local.set({ downloadQueue })
        window.open(`download.html?autoId=${newId}`)
      }
    })

    // 绑定删除事件
    document.querySelectorAll('.btn-del').forEach(btn => {
      btn.onclick = async () => {
        videos = videos.filter(v => v.url !== btn.dataset.url)
        m3u8Cache[tab.id] = videos
        await chrome.storage.local.set({ m3u8Cache })
        renderList()
      }
    })
  }

  renderList()
  document.getElementById('open-manager').onclick = () => window.open('download.html')
})