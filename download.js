/** 💡 核心补丁：Worker 重定向 **/
const _createObjectURL = URL.createObjectURL
URL.createObjectURL = function (obj) {
  if (obj instanceof Blob && (obj.type.includes('javascript') || obj.type === '')) {
    return chrome.runtime.getURL('lib/ffmpeg-core.worker.js')
  }
  return _createObjectURL.call(URL, obj)
}

// 状态管理
let activeCount = 0
let taskQueue = []
let taskChunks = {}

// 1. 自动调度器
async function scheduleNext () {
  const settings = await chrome.storage.local.get({ concurrency: 2 })
  const limit = parseInt(settings.concurrency)

  if (activeCount < limit && taskQueue.length > 0) {
    const taskId = taskQueue.shift()
    activeCount++
    executeTask(taskId).finally(() => {
      activeCount--
      scheduleNext()
    })
  }
}

// 2. 状态更新与 UI 渲染
async function updateTask (id, obj) {
  const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
  const idx = downloadQueue.findIndex(t => t.id == id)
  if (idx !== -1) {
    downloadQueue[idx] = { ...downloadQueue[idx], ...obj }
    await chrome.storage.local.set({ downloadQueue })
    render()
  }
}

function render () {
  chrome.storage.local.get('downloadQueue', ({ downloadQueue = [] }) => {
    const list = document.getElementById('tasks-list')
    if (!list) return
    list.innerHTML = downloadQueue.map(t => `
            <div class="task-card">
                <div style="display:flex; justify-content:space-between; font-weight:bold; color:#444;">
                    <span>${t.title}</span>
                    <span>${t.progress}%</span>
                </div>
                <div class="progress-container">
                    <div class="progress-bar" style="width: ${t.progress}%"></div>
                </div>
                <div style="display:flex; gap:20px; font-size:13px; color:#666;">
                    <span class="status-tag">${t.status}</span>
                    <span>📦 ${t.size || '0.00'} MB</span>
                    <span>${t.mode === 'pro' ? '🎥 MP4' : '📄 TS'}</span>
                </div>
            </div>
        `).reverse().join('')
  })
}

// 3. 任务执行核心
async function executeTask (id) {
  const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
  const task = downloadQueue.find(t => t.id == id)
  if (!task) return

  try {
    await updateTask(task.id, { status: '解析资源...' })
    let res = await fetch(task.url)
    let text = await res.text()

    // 嵌套流解析
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

    // 广告过滤
    const finalUrls = tsUrls.filter(u => !/adslot|advert|doubleclick/i.test(u))

    taskChunks[task.id] = []
    for (let i = 0; i < finalUrls.length; i++) {
      const tsRes = await fetch(finalUrls[i])
      taskChunks[task.id].push(await tsRes.arrayBuffer())

      if (i % 20 === 0 || i === finalUrls.length - 1) {
        const p = Math.floor(((i + 1) / finalUrls.length) * 100)
        const bytes = taskChunks[task.id].reduce((s, b) => s + b.byteLength, 0)
        await updateTask(task.id, {
          progress: p,
          size: (bytes / 1024 / 1024).toFixed(2),
          status: '正在下载...'
        })
      }
    }

    await updateTask(task.id, { status: '封装转码中...' })
    await finalize(task)

  } catch (e) {
    await updateTask(task.id, { status: '下载失败' })
  }
}

async function finalize (task) {
  const chunks = taskChunks[task.id]
  if (!chunks) return

  let blob, ext
  if (task.mode === 'pro') {
    const ffmpeg = FFmpeg.createFFmpeg({
      log: true,
      workerPath: chrome.runtime.getURL('lib/ffmpeg-core.worker.js'),
      mainName: 'main'
    })

    try {
      await ffmpeg.load()
      const totalSize = chunks.reduce((acc, curr) => acc + curr.byteLength, 0)
      const combined = new Uint8Array(totalSize)
      let offset = 0
      for (const c of chunks) { combined.set(new Uint8Array(c), offset); offset += c.byteLength }

      ffmpeg.FS('writeFile', 'in.ts', combined)
      await ffmpeg.run('-i', 'in.ts', '-c', 'copy', 'out.mp4')
      blob = new Blob([ffmpeg.FS('readFile', 'out.mp4').buffer], { type: 'video/mp4' })
      ext = 'mp4'
    } catch (err) {
      blob = new Blob(chunks, { type: 'video/mp2t' })
      ext = 'ts'
    }
  } else {
    blob = new Blob(chunks, { type: 'video/mp2t' })
    ext = 'ts'
  }

  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${task.title.replace(/[^\w]/g, '_')}.${ext}`
  a.click()
  await updateTask(task.id, { status: '完成', progress: 100 })
  delete taskChunks[task.id]
}

// 4. 初始化与监听
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'NEW_TASK') {
    taskQueue.push(msg.id)
    updateTask(msg.id, { status: '排队中...' })
    scheduleNext()
  }
})

document.addEventListener('DOMContentLoaded', async () => {
  // 加载并发设置
  const { concurrency = 2 } = await chrome.storage.local.get('concurrency')
  const input = document.getElementById('concurrency-limit')
  input.value = concurrency
  input.onchange = (e) => {
    chrome.storage.local.set({ concurrency: e.target.value })
    scheduleNext()
  }

  // 检查自动开始
  const autoId = new URLSearchParams(window.location.search).get('autoId')
  if (autoId) {
    taskQueue.push(autoId)
    scheduleNext()
  }

  render()
  document.getElementById('clear-all').onclick = () => {
    chrome.storage.local.set({ downloadQueue: [] }, render)
  }
})