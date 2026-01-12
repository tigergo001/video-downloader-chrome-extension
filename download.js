/** 💡 CSP & Worker 重定向补丁 **/
const _createObjectURL = URL.createObjectURL
URL.createObjectURL = function (obj) {
  if (obj instanceof Blob && (obj.type.includes('javascript') || obj.type === '')) {
    return chrome.runtime.getURL('lib/ffmpeg-core.worker.js')
  }
  return _createObjectURL.call(URL, obj)
}

let activeControllers = {}
let taskChunks = {}

// 1. 状态维护函数
async function updateTask (id, obj) {
  const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
  const idx = downloadQueue.findIndex(t => t.id == id)
  if (idx !== -1) {
    downloadQueue[idx] = { ...downloadQueue[idx], ...obj }
    await chrome.storage.local.set({ downloadQueue })
    render()
  }
}

// 2. UI 渲染渲染
function render () {
  chrome.storage.local.get('downloadQueue', ({ downloadQueue = [] }) => {
    const list = document.getElementById('tasks-list')
    if (!list) return
    list.innerHTML = downloadQueue.map(t => `
            <div class="task-card">
                <div class="task-info">
                    <span>${t.title}</span>
                    <span>${t.progress}%</span>
                </div>
                <div class="progress-container">
                    <div class="progress-bar" style="width: ${t.progress}%"></div>
                </div>
                <div class="task-meta">
                    <span class="status-tag">${t.status}</span>
                    <span>📦 ${t.size || 0} MB</span>
                    <span>⚙️ ${t.mode === 'pro' ? 'MP4 高级封装' : 'TS 极速导出'}</span>
                </div>
            </div>
        `).reverse().join('')
  })
}

// 3. 下载流程
async function runDownload (task) {
  if (activeControllers[task.id]) return
  const controller = new AbortController()
  activeControllers[task.id] = controller

  try {
    await updateTask(task.id, { status: '解析资源中...' })
    let res = await fetch(task.url)
    let text = await res.text()

    // 识别嵌套流
    if (text.includes("#EXT-X-STREAM-INF")) {
      const lines = text.split('\n').filter(l => l.trim() && !l.startsWith('#'))
      const subUrl = lines[lines.length - 1]
      const baseUrl = task.url.substring(0, task.url.lastIndexOf('/') + 1)
      res = await fetch(subUrl.startsWith('http') ? subUrl : baseUrl + subUrl)
      text = await res.text()
    }

    const baseUrl = task.url.substring(0, task.url.lastIndexOf('/') + 1)
    const tsUrls = text.split('\n').filter(l => l.trim() && !l.startsWith('#'))
      .map(l => l.startsWith('http') ? l : baseUrl + l)

    // 💡 广告过滤逻辑：识别并移除短小的广告切片
    const filteredUrls = tsUrls.filter(u => !/adslot|advert|doubleclick|m3u8_ad/i.test(u))
    if (filteredUrls.length < 5) {
      await updateTask(task.id, { status: '忽略无效广告流', progress: 0 })
      return
    }

    taskChunks[task.id] = []
    for (let i = 0; i < filteredUrls.length; i++) {
      const tsRes = await fetch(filteredUrls[i], { signal: controller.signal })
      const buf = await tsRes.arrayBuffer()
      taskChunks[task.id].push(buf)

      if (i % 15 === 0 || i === filteredUrls.length - 1) {
        const p = Math.floor(((i + 1) / filteredUrls.length) * 100)
        const currentBytes = taskChunks[task.id].reduce((s, b) => s + b.byteLength, 0)
        await updateTask(task.id, {
          progress: p,
          size: (currentBytes / 1024 / 1024).toFixed(2),
          status: '正在下载正片...'
        })
      }
    }

    await updateTask(task.id, { status: '视频合成封装中...' })
    await finalize(task)

  } catch (e) {
    console.error("下载中断:", e)
    await updateTask(task.id, { status: '已停止' })
  } finally {
    delete activeControllers[task.id]
  }
}

async function finalize (task) {
  const chunks = taskChunks[task.id]
  if (!chunks || chunks.length === 0) return

  let blob, ext
  if (task.mode === 'pro') {
    const ffmpeg = FFmpeg.createFFmpeg({
      log: true,
      workerPath: chrome.runtime.getURL('lib/ffmpeg-core.worker.js'),
      mainName: 'main'
    })

    try {
      await ffmpeg.load()
      // 合并分片
      const totalSize = chunks.reduce((acc, curr) => acc + curr.byteLength, 0)
      const combinedData = new Uint8Array(totalSize)
      let offset = 0
      for (const chunk of chunks) {
        combinedData.set(new Uint8Array(chunk), offset)
        offset += chunk.byteLength
      }
      ffmpeg.FS('writeFile', 'temp.ts', combinedData)
      // 封装为 MP4
      await ffmpeg.run('-i', 'temp.ts', '-c', 'copy', 'output.mp4')
      const data = ffmpeg.FS('readFile', 'output.mp4')
      blob = new Blob([data.buffer], { type: 'video/mp4' })
      ext = 'mp4'
    } catch (err) {
      console.error("FFmpeg 转码失败，改为合并下载:", err)
      blob = new Blob(chunks, { type: 'video/mp2t' })
      ext = 'ts'
    }
  } else {
    blob = new Blob(chunks, { type: 'video/mp2t' })
    ext = 'ts'
  }

  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${task.title.replace(/[^\w\u4e00-\u9fa5]/g, '_')}_${Date.now()}.${ext}`
  a.click()
  await updateTask(task.id, { status: '已完成并保存', progress: 100 })
}

async function runDownloadById (id) {
  const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
  const task = downloadQueue.find(t => t.id == id)
  if (task) runDownload(task)
}

// 初始化
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'NEW_TASK') runDownloadById(msg.id)
})

document.addEventListener('DOMContentLoaded', () => {
  const autoId = new URLSearchParams(window.location.search).get('autoId')
  if (autoId) runDownloadById(autoId)
  render()
  document.getElementById('clear-all').onclick = () => {
    chrome.storage.local.set({ downloadQueue: [] }, render)
  }
})