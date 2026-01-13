// document.addEventListener('DOMContentLoaded', async () => {
//   const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
//   const { m3u8Cache = {} } = await chrome.storage.local.get('m3u8Cache')
//   let videos = m3u8Cache[tab.id] || []
//   const list = document.getElementById('list')

//   const renderList = () => {
//     // 1. 过滤逻辑：只保留正片疑似资源，排除包含广告关键字的链接
//     const filtered = videos.filter(v => !/adslot|advert|doubleclick|\.ts$/i.test(v.url))

//     if (filtered.length === 0) {
//       list.innerHTML = '<div style="padding:40px;text-align:center;color:#999;font-size:13px;">暂无有效视频资源</div>'
//       return
//     }

//     list.innerHTML = filtered.reverse().map((v, i) => `
//       <div class="card" style="padding:12px; border-bottom:1px solid #f0f0f0;">
//         <div style="font-size:12px; font-weight:600; margin-bottom:8px; color:#333; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
//           ${i === 0 ? '✨ 疑似正片：' : '资源：'}${tab.title}
//         </div>
//         <div style="display:flex; gap:8px;">
//           <button class="btn-pro" data-url="${v.url}" style="flex:1; background:#5856d6; color:#fff; border:none; padding:8px; border-radius:6px; cursor:pointer; font-size:12px;">极速下载 (MP4)</button>
//           <button class="btn-del" data-url="${v.url}" style="width:50px; background:#ff3b30; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:12px;">删除</button>
//         </div>
//       </div>
//     `).join('')

//     // 绑定极速下载事件
//     document.querySelectorAll('.btn-pro').forEach(btn => {
//       btn.onclick = async () => {
//         const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
//         const newId = Date.now()
//         downloadQueue.push({
//           id: newId, url: btn.dataset.url, title: tab.title,
//           mode: 'pro', status: 'pending', progress: 0, size: '0'
//         })
//         await chrome.storage.local.set({ downloadQueue })
//         window.open(`download.html?autoId=${newId}`)
//       }
//     })

//     // 绑定删除事件
//     document.querySelectorAll('.btn-del').forEach(btn => {
//       btn.onclick = async () => {
//         videos = videos.filter(v => v.url !== btn.dataset.url)
//         m3u8Cache[tab.id] = videos
//         await chrome.storage.local.set({ m3u8Cache })
//         renderList()
//       }
//     })
//   }

//   renderList()
//   document.getElementById('open-manager').onclick = () => window.open('download.html')
// })



// ----- new ------------

document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const { m3u8Cache = {} } = await chrome.storage.local.get('m3u8Cache')
  let videos = m3u8Cache[tab.id] || []
  const list = document.getElementById('list')

  // 🔥 新增：智能评分函数，识别正片
  function scoreVideo (url, pageTitle) {
    let score = 100
    const urlLower = url.toLowerCase()

    // 🚫 强烈降权：广告关键词
    const adKeywords = [
      'ad', 'adv', 'advert', 'ads', 'adslot', 'advertising',
      'banner', 'preroll', 'midroll', 'postroll',
      'doubleclick', 'googlesyndication', 'adservice',
      'promote', 'sponsor', 'commercial',
      'popup', 'overlay'
    ]

    for (const keyword of adKeywords) {
      if (urlLower.includes(keyword)) {
        score -= 80
        console.log(`⚠️ 广告关键词 "${keyword}" 降权: ${url}`)
        break
      }
    }

    // 🚫 中度降权：其他垃圾内容
    const junkKeywords = [
      'log', 'stat', 'track', 'analytics', 'telemetry',
      'beacon', 'pixel', 'counter', 'report',
      'share', 'social', 'comment',
      'thumb', 'preview', 'poster', 'cover'
    ]

    for (const keyword of junkKeywords) {
      if (urlLower.includes(keyword)) {
        score -= 40
        break
      }
    }

    // ✅ 加权：包含视频相关关键词
    const videoKeywords = [
      'video', 'movie', 'film', 'play', 'stream',
      'content', 'media', 'vod', 'hls', 'dash',
      'episode', 'ep', 'season', 'series'
    ]

    for (const keyword of videoKeywords) {
      if (urlLower.includes(keyword)) {
        score += 20
        break
      }
    }

    // ✅ 加权：URL 结构特征
    // 正片通常在较深的目录层级
    const pathDepth = (url.match(/\//g) || []).length
    if (pathDepth >= 5) {
      score += 15
    }

    // ✅ 加权：文件名包含数字（可能是集数）
    const hasNumber = /\d{2,}/.test(url)
    if (hasNumber) {
      score += 10
    }

    // ✅ 加权：常见视频 CDN 域名
    const videoCDNs = ['cdn', 'vod', 'video', 'stream', 'play', 'media']
    const domain = url.split('/')[2] || ''
    for (const cdn of videoCDNs) {
      if (domain.includes(cdn)) {
        score += 15
        break
      }
    }

    // 🚫 降权：过短的 URL（可能是跟踪像素）
    if (url.length < 50) {
      score -= 30
    }

    // ✅ 加权：URL 包含页面标题关键词
    if (pageTitle && url.includes(pageTitle.split(' ')[0])) {
      score += 10
    }

    return Math.max(0, score)
  }

  // 🔥 新增：按评分排序并标记
  function categorizeVideos (videos, pageTitle) {
    const scored = videos.map(v => ({
      ...v,
      score: scoreVideo(v.url, pageTitle)
    }))

    // 按分数排序
    scored.sort((a, b) => b.score - a.score)

    console.log('📊 视频资源评分:')
    scored.forEach((v, i) => {
      console.log(`  ${i + 1}. 分数 ${v.score} - ${v.url.substring(0, 80)}...`)
    })

    return scored
  }

  const renderList = () => {
    // 过滤并评分
    const filtered = videos.filter(v => {
      const url = v.url.toLowerCase()
      // 基础过滤：排除明显的广告和 .ts 文件
      return !/\.ts($|\?)|adslot|doubleclick/i.test(url)
    })

    if (filtered.length === 0) {
      list.innerHTML = '<div style="padding:40px;text-align:center;color:#999;font-size:13px;">暂无视频资源</div>'
      return
    }

    // 智能分类
    const categorized = categorizeVideos(filtered, tab.title)

    // 🔥 识别正片：分数最高的前 3 个
    const topScores = categorized.slice(0, 3)
    const avgTopScore = topScores.reduce((sum, v) => sum + v.score, 0) / topScores.length

    list.innerHTML = categorized.map((v, i) => {
      const isMainVideo = v.score >= avgTopScore && i < 3
      const isLowQuality = v.score < 50

      // 低质量资源折叠显示
      if (isLowQuality && i >= 5) {
        return '' // 不显示低分且靠后的资源
      }

      return `
        <div class="card" style="padding:12px; border-bottom:1px solid #f0f0f0; ${isLowQuality ? 'opacity:0.5;' : ''}">
          <div style="font-size:12px; font-weight:600; margin-bottom:8px; color:#333; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${isMainVideo ? '⭐ 正片推荐：' : isLowQuality ? '🔸 其他：' : '📹 视频：'}${tab.title}
            ${isMainVideo ? '<span style="background:#ff3b30; color:white; padding:2px 6px; border-radius:4px; font-size:10px; margin-left:8px;">推荐</span>' : ''}
          </div>
          <div style="font-size:10px; color:#888; margin-bottom:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${v.url}">
            ${v.url}
          </div>
          <div style="display:flex; gap:8px;">
            <button class="btn-pro" data-url="${v.url}" style="flex:1; background:${isMainVideo ? '#ff3b30' : '#5856d6'}; color:#fff; border:none; padding:8px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600;">
              ${isMainVideo ? '🚀 立即下载' : '下载'}
            </button>
            <button class="btn-del" data-url="${v.url}" style="width:50px; background:#ccc; color:#fff; border:none; border-radius:6px; cursor:pointer; font-size:12px;">删除</button>
          </div>
        </div>
      `
    }).join('')

    // 绑定下载事件
    document.querySelectorAll('.btn-pro').forEach(btn => {
      btn.onclick = async () => {
        const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
        const newId = Date.now()
        downloadQueue.push({
          id: newId,
          url: btn.dataset.url,
          title: tab.title,
          mode: 'pro',
          status: 'pending',
          progress: 0,
          size: '0'
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