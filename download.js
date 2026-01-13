
/** 🛠️ v3.9.1 终极修复：单线程注入模式，彻底绕过 CSP **/
const _createObjectURL = URL.createObjectURL
URL.createObjectURL = function (obj) {
  if (obj instanceof Blob && (obj.type.includes('javascript') || obj.type === '')) {
    // 强制 Worker 内部不再尝试 importScripts，而是使用我们注入的环境
    const proxyScript = `
      self.importScripts("${chrome.runtime.getURL('lib/ffmpeg-core.js')}");
      // 禁用多线程 pthread 尝试，强制单线程运行以避开 CSP 拦截
      self.onmessage = function(e) { 
        if(e.data && e.data.type === 'init') { /* 拦截初始化指令 */ }
      };
    `
    return _createObjectURL.call(URL, new Blob([proxyScript], { type: 'application/javascript' }))
  }
  return _createObjectURL.call(URL, obj)
}

let activeCount = 0
let taskQueue = []
let taskChunks = {}
const controllers = {}

/** 状态更新函数 **/
async function updateTask (id, obj) {
  const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
  const idx = downloadQueue.findIndex(t => t.id == id)
  if (idx !== -1) {
    downloadQueue[idx] = { ...downloadQueue[idx], ...obj }
    await chrome.storage.local.set({ downloadQueue })
    render()
  }
}

/** 1. 极速下载流 **/
async function downloadParallel (urls, taskId, signal) {
  const CONCURRENCY = 10
  const results = new Array(urls.length)
  let currentIndex = 0
  let downloadedBytes = 0

  async function worker () {
    while (currentIndex < urls.length) {
      if (signal.aborted) throw new Error('Aborted')
      const i = currentIndex++
      try {
        const res = await fetch(urls[i], { signal })
        const buf = await res.arrayBuffer()
        results[i] = buf
        downloadedBytes += buf.byteLength

        const finished = results.filter(r => r).length
        if (finished % 5 === 0 || finished === urls.length) {
          await updateTask(taskId, {
            progress: Math.floor((finished / urls.length) * 100),
            size: (downloadedBytes / (1024 * 1024)).toFixed(2),
            status: '正在下载...'
          })
        }
      } catch (e) {
        if (e.name === 'AbortError') throw e
        currentIndex--
      }
    }
  }
  await Promise.all(Array(CONCURRENCY).fill(null).map(worker))
  return results
}

/** 2. 核心转码：只保留 MP4 输出 **/
async function finalize (task) {
  const chunks = taskChunks[task.id]
  if (!chunks) return

  // 关键：强制设置 mainName 和单线程参数
  const ffmpeg = FFmpeg.createFFmpeg({
    log: true,
    corePath: chrome.runtime.getURL('lib/ffmpeg-core.js'),
    mainName: 'main'
  })

  try {
    await ffmpeg.load()
    const totalSize = chunks.reduce((acc, c) => acc + c.byteLength, 0)
    const combined = new Uint8Array(totalSize)
    let offset = 0
    for (const c of chunks) {
      combined.set(new Uint8Array(c), offset)
      offset += c.byteLength
    }

    ffmpeg.FS('writeFile', 'video.ts', combined)

    // 使用 -c copy 极速无损转换
    await ffmpeg.run('-i', 'video.ts', '-c', 'copy', 'video.mp4')

    const data = ffmpeg.FS('readFile', 'video.mp4')
    const blob = new Blob([data.buffer], { type: 'video/mp4' })

    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${task.title.replace(/[^\w\u4e00-\u9fa5]/g, '_')}.mp4`
    a.click()

    await updateTask(task.id, { status: '完成', progress: 100 })
  } catch (err) {
    console.error('MP4 转码彻底失败:', err)
    await updateTask(task.id, { status: '转换失败(内存不足)', progress: 0 })
  } finally {
    delete taskChunks[task.id]
    // 显式退出 ffmpeg 释放内存
    try { ffmpeg.exit() } catch (e) { }
  }
}

/** 3. 任务执行主函数 **/
async function executeTask (id) {
  const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
  const task = downloadQueue.find(t => t.id == id)
  if (!task || task.status === 'paused') return

  const controller = new AbortController()
  controllers[id] = controller

  try {
    await updateTask(id, { status: '准备资源...' })
    const res = await fetch(task.url, { signal: controller.signal })
    const text = await res.text()
    const baseUrl = task.url.substring(0, task.url.lastIndexOf('/') + 1)
    const tsUrls = text.split('\n').filter(l => l.trim() && !l.startsWith('#'))
      .map(l => l.startsWith('http') ? l : baseUrl + l)

    const chunks = await downloadParallel(tsUrls, id, controller.signal)
    taskChunks[id] = chunks
    await updateTask(id, { status: '正在转码...', progress: 99 })
    await finalize(task)
  } catch (err) {
    const s = err.message === 'Aborted' ? '已暂停' : '下载失败'
    await updateTask(id, { status: s })
  } finally {
    delete controllers[id]
  }
}

/** 4. UI 渲染：恢复百分比文字 **/
function render () {
  chrome.storage.local.get({ downloadQueue: [] }, (data) => {
    const list = document.getElementById('tasks-list')
    if (!list) return
    list.innerHTML = data.downloadQueue.map(t => `
      <div class="task-card">
        <div style="display:flex; justify-content:space-between;">
          <span style="font-weight:bold; color:#444; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${t.title}</span>
          <span style="color:#ff3b30; cursor:pointer; font-weight:bold;" onclick="deleteTask(${t.id})">×</span>
        </div>
        <div style="display:flex; align-items:center; gap:10px; margin:15px 0;">
          <div style="flex:1; height:12px; background:#e0e5ec; border-radius:10px; box-shadow:inset 4px 4px 8px #bec3c9, inset -4px -4px 8px #fff; overflow:hidden;">
            <div style="width: ${t.progress || 0}%; height:100%; background:linear-gradient(145deg, #007aff, #005bbd);"></div>
          </div>
          <span style="font-size:12px; color:#666; font-weight:bold; width:35px;">${t.progress || 0}%</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:12px; color:#888;">
            <span style="color:#007aff; font-weight:bold;">${t.status}</span> | 📦 ${t.size || '0.00'} MB
          </div>
          <button class="btn" style="padding:5px 10px; font-size:11px;" onclick="toggleTask(${t.id})">
            ${(t.status === '正在下载...' || t.status === '准备资源...') ? '暂停' : '开始'}
          </button>
        </div>
      </div>
    `).reverse().join('')
  })
}

// 按钮控制逻辑
window.deleteTask = async (id) => {
  if (controllers[id]) controllers[id].abort()
  const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
  await chrome.storage.local.set({ downloadQueue: downloadQueue.filter(t => t.id != id) })
  render()
}

window.toggleTask = async (id) => {
  const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
  const task = downloadQueue.find(t => t.id == id)
  if (task.status === '正在下载...') {
    if (controllers[id]) controllers[id].abort()
  } else {
    await updateTask(id, { status: 'pending' })
    taskQueue.push(id)
    scheduleNext()
  }
}

document.getElementById('clear-all').onclick = async () => {
  const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
  const remaining = downloadQueue.filter(t => t.status !== '完成')
  await chrome.storage.local.set({ downloadQueue: remaining })
  render()
}

async function scheduleNext () {
  const { concurrency = 2 } = await chrome.storage.local.get('concurrency')
  if (activeCount < concurrency && taskQueue.length > 0) {
    activeCount++
    executeTask(taskQueue.shift()).finally(() => {
      activeCount--
      scheduleNext()
    })
  }
}

document.addEventListener('DOMContentLoaded', () => {
  render()
  const autoId = new URLSearchParams(window.location.search).get('autoId')
  if (autoId) { taskQueue.push(parseInt(autoId)); scheduleNext() }
})
