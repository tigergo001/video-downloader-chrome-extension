
// /** 🛠️ v3.9.1 终极修复：单线程注入模式，彻底绕过 CSP **/
// const _createObjectURL = URL.createObjectURL
// URL.createObjectURL = function (obj) {
//   if (obj instanceof Blob && (obj.type.includes('javascript') || obj.type === '')) {
//     // 强制 Worker 内部不再尝试 importScripts，而是使用我们注入的环境
//     const proxyScript = `
//       self.importScripts("${chrome.runtime.getURL('lib/ffmpeg-core.js')}");
//       // 禁用多线程 pthread 尝试，强制单线程运行以避开 CSP 拦截
//       self.onmessage = function(e) { 
//         if(e.data && e.data.type === 'init') { /* 拦截初始化指令 */ }
//       };
//     `
//     return _createObjectURL.call(URL, new Blob([proxyScript], { type: 'application/javascript' }))
//   }
//   return _createObjectURL.call(URL, obj)
// }

// let activeCount = 0
// let taskQueue = []
// let taskChunks = {}
// const controllers = {}

// /** 状态更新函数 **/
// async function updateTask (id, obj) {
//   const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
//   const idx = downloadQueue.findIndex(t => t.id == id)
//   if (idx !== -1) {
//     downloadQueue[idx] = { ...downloadQueue[idx], ...obj }
//     await chrome.storage.local.set({ downloadQueue })
//     render()
//   }
// }

// /** 1. 极速下载流 **/
// async function downloadParallel (urls, taskId, signal) {
//   const CONCURRENCY = 10
//   const results = new Array(urls.length)
//   let currentIndex = 0
//   let downloadedBytes = 0

//   async function worker () {
//     while (currentIndex < urls.length) {
//       if (signal.aborted) throw new Error('Aborted')
//       const i = currentIndex++
//       try {
//         const res = await fetch(urls[i], { signal })
//         const buf = await res.arrayBuffer()
//         results[i] = buf
//         downloadedBytes += buf.byteLength

//         const finished = results.filter(r => r).length
//         if (finished % 5 === 0 || finished === urls.length) {
//           await updateTask(taskId, {
//             progress: Math.floor((finished / urls.length) * 100),
//             size: (downloadedBytes / (1024 * 1024)).toFixed(2),
//             status: '正在下载...'
//           })
//         }
//       } catch (e) {
//         if (e.name === 'AbortError') throw e
//         currentIndex--
//       }
//     }
//   }
//   await Promise.all(Array(CONCURRENCY).fill(null).map(worker))
//   return results
// }

// /** 2. 核心转码：只保留 MP4 输出 **/
// async function finalize (task) {
//   const chunks = taskChunks[task.id]
//   if (!chunks) return

//   // 关键：强制设置 mainName 和单线程参数
//   const ffmpeg = FFmpeg.createFFmpeg({
//     log: true,
//     corePath: chrome.runtime.getURL('lib/ffmpeg-core.js'),
//     mainName: 'main'
//   })

//   try {
//     await ffmpeg.load()
//     const totalSize = chunks.reduce((acc, c) => acc + c.byteLength, 0)
//     const combined = new Uint8Array(totalSize)
//     let offset = 0
//     for (const c of chunks) {
//       combined.set(new Uint8Array(c), offset)
//       offset += c.byteLength
//     }

//     ffmpeg.FS('writeFile', 'video.ts', combined)

//     // 使用 -c copy 极速无损转换
//     await ffmpeg.run('-i', 'video.ts', '-c', 'copy', 'video.mp4')

//     const data = ffmpeg.FS('readFile', 'video.mp4')
//     const blob = new Blob([data.buffer], { type: 'video/mp4' })

//     const a = document.createElement('a')
//     a.href = URL.createObjectURL(blob)
//     a.download = `${task.title.replace(/[^\w\u4e00-\u9fa5]/g, '_')}.mp4`
//     a.click()

//     await updateTask(task.id, { status: '完成', progress: 100 })
//   } catch (err) {
//     console.error('MP4 转码彻底失败:', err)
//     await updateTask(task.id, { status: '转换失败(内存不足)', progress: 0 })
//   } finally {
//     delete taskChunks[task.id]
//     // 显式退出 ffmpeg 释放内存
//     try { ffmpeg.exit() } catch (e) { }
//   }
// }

// /** 3. 任务执行主函数 **/
// async function executeTask (id) {
//   const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
//   const task = downloadQueue.find(t => t.id == id)
//   if (!task || task.status === 'paused') return

//   const controller = new AbortController()
//   controllers[id] = controller

//   try {
//     await updateTask(id, { status: '准备资源...' })
//     const res = await fetch(task.url, { signal: controller.signal })
//     const text = await res.text()
//     const baseUrl = task.url.substring(0, task.url.lastIndexOf('/') + 1)
//     const tsUrls = text.split('\n').filter(l => l.trim() && !l.startsWith('#'))
//       .map(l => l.startsWith('http') ? l : baseUrl + l)

//     const chunks = await downloadParallel(tsUrls, id, controller.signal)
//     taskChunks[id] = chunks
//     await updateTask(id, { status: '正在转码...', progress: 99 })
//     await finalize(task)
//   } catch (err) {
//     const s = err.message === 'Aborted' ? '已暂停' : '下载失败'
//     await updateTask(id, { status: s })
//   } finally {
//     delete controllers[id]
//   }
// }

// /** 4. UI 渲染：恢复百分比文字 **/
// function render () {
//   chrome.storage.local.get({ downloadQueue: [] }, (data) => {
//     const list = document.getElementById('tasks-list')
//     if (!list) return
//     list.innerHTML = data.downloadQueue.map(t => `
//       <div class="task-card">
//         <div style="display:flex; justify-content:space-between;">
//           <span style="font-weight:bold; color:#444; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${t.title}</span>
//           <span style="color:#ff3b30; cursor:pointer; font-weight:bold;" onclick="deleteTask(${t.id})">×</span>
//         </div>
//         <div style="display:flex; align-items:center; gap:10px; margin:15px 0;">
//           <div style="flex:1; height:12px; background:#e0e5ec; border-radius:10px; box-shadow:inset 4px 4px 8px #bec3c9, inset -4px -4px 8px #fff; overflow:hidden;">
//             <div style="width: ${t.progress || 0}%; height:100%; background:linear-gradient(145deg, #007aff, #005bbd);"></div>
//           </div>
//           <span style="font-size:12px; color:#666; font-weight:bold; width:35px;">${t.progress || 0}%</span>
//         </div>
//         <div style="display:flex; justify-content:space-between; align-items:center;">
//           <div style="font-size:12px; color:#888;">
//             <span style="color:#007aff; font-weight:bold;">${t.status}</span> | 📦 ${t.size || '0.00'} MB
//           </div>
//           <button class="btn" style="padding:5px 10px; font-size:11px;" onclick="toggleTask(${t.id})">
//             ${(t.status === '正在下载...' || t.status === '准备资源...') ? '暂停' : '开始'}
//           </button>
//         </div>
//       </div>
//     `).reverse().join('')
//   })
// }

// // 按钮控制逻辑
// window.deleteTask = async (id) => {
//   if (controllers[id]) controllers[id].abort()
//   const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
//   await chrome.storage.local.set({ downloadQueue: downloadQueue.filter(t => t.id != id) })
//   render()
// }

// window.toggleTask = async (id) => {
//   const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
//   const task = downloadQueue.find(t => t.id == id)
//   if (task.status === '正在下载...') {
//     if (controllers[id]) controllers[id].abort()
//   } else {
//     await updateTask(id, { status: 'pending' })
//     taskQueue.push(id)
//     scheduleNext()
//   }
// }

// document.getElementById('clear-all').onclick = async () => {
//   const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
//   const remaining = downloadQueue.filter(t => t.status !== '完成')
//   await chrome.storage.local.set({ downloadQueue: remaining })
//   render()
// }

// async function scheduleNext () {
//   const { concurrency = 2 } = await chrome.storage.local.get('concurrency')
//   if (activeCount < concurrency && taskQueue.length > 0) {
//     activeCount++
//     executeTask(taskQueue.shift()).finally(() => {
//       activeCount--
//       scheduleNext()
//     })
//   }
// }

// document.addEventListener('DOMContentLoaded', () => {
//   render()
//   const autoId = new URLSearchParams(window.location.search).get('autoId')
//   if (autoId) { taskQueue.push(parseInt(autoId)); scheduleNext() }
// })


// ----- new version 
/** 🛠️ v6.2.0 支持加密视频检测和处理
 * 新增功能：
 * 1. 检测 M3U8 中的加密信息（#EXT-X-KEY）
 * 2. 自动解密 AES-128 加密的 TS 分片
 * 3. 更宽松的 TS 验证（兼容非标准格式）
 * 4. 提供原始文件导出选项
 */

// const _createObjectURL = URL.createObjectURL
// URL.createObjectURL = function (obj) {
//   if (obj instanceof Blob && (obj.type.includes('javascript') || obj.type === '')) {
//     const scriptText = `self.importScripts("${chrome.runtime.getURL('lib/ffmpeg-core.js')}");`
//     return _createObjectURL.call(URL, new Blob([scriptText], { type: 'application/javascript' }))
//   }
//   return _createObjectURL.call(URL, obj)
// }

// let activeCount = 0
// let taskQueue = []
// const taskChunks = {}
// const controllers = {}
// const deletedTasks = new Set()
// const encryptionKeys = {} // 存储解密密钥

// const LARGE_FILE_THRESHOLD = 500 * 1024 * 1024
// const MEMORY_SAFE_LIMIT = 300 * 1024 * 1024

// function triggerDownload (blob, baseName, extension) {
//   const safeTitle = baseName.replace(/[\\/:*?"<>|]/g, "_")
//   const finalFileName = `${safeTitle}.${extension}`
//   const url = URL.createObjectURL(blob)
//   const a = document.createElement('a')
//   a.href = url
//   a.download = finalFileName
//   document.body.appendChild(a)
//   a.click()
//   document.body.removeChild(a)
//   setTimeout(() => URL.revokeObjectURL(url), 60000)
// }

// // --- 🔥 新增：AES-128 解密函数 ---
// async function decryptAES128 (encryptedData, keyUri, iv, segmentIndex = 0) {
//   try {
//     console.log(`🔐 正在获取密钥: ${keyUri}`)

//     // 获取密钥
//     let keyData
//     if (encryptionKeys[keyUri]) {
//       keyData = encryptionKeys[keyUri]
//       console.log(`✅ 使用缓存的密钥`)
//     } else {
//       const keyResponse = await fetch(keyUri)
//       if (!keyResponse.ok) {
//         throw new Error(`密钥获取失败: HTTP ${keyResponse.status}`)
//       }
//       const keyBuffer = await keyResponse.arrayBuffer()
//       keyData = new Uint8Array(keyBuffer)
//       encryptionKeys[keyUri] = keyData
//       console.log(`🔑 密钥已获取并缓存 (${keyData.length} 字节)`)
//     }

//     // 导入密钥
//     const key = await crypto.subtle.importKey(
//       'raw',
//       keyData,
//       { name: 'AES-CBC', length: 128 },
//       false,
//       ['decrypt']
//     )

//     // IV 处理
//     let ivBuffer
//     if (iv) {
//       // 解析 hex IV (格式: 0x12345678...)
//       const ivHex = iv.replace('0x', '').replace('0X', '')
//       ivBuffer = new Uint8Array(ivHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)))
//       console.log(`使用提供的 IV: ${iv}`)
//     } else {
//       // 使用分片序号作为 IV（HLS 标准）
//       ivBuffer = new Uint8Array(16)
//       const view = new DataView(ivBuffer.buffer)
//       view.setUint32(12, segmentIndex, false) // big-endian
//       console.log(`使用序号作为 IV: ${segmentIndex}`)
//     }

//     // 解密
//     const decrypted = await crypto.subtle.decrypt(
//       { name: 'AES-CBC', iv: ivBuffer },
//       key,
//       encryptedData
//     )

//     return new Uint8Array(decrypted)
//   } catch (err) {
//     console.error(`❌ 解密失败:`, err)
//     return null
//   }
// }

// // --- 🔥 更新：宽松的 TS 验证（支持加密前的数据）---
// function validateAndCleanTS (buffer, skipValidation = false) {
//   const data = new Uint8Array(buffer)

//   if (data.length === 0) {
//     return null
//   }

//   // 如果跳过验证（加密文件），直接返回
//   if (skipValidation) {
//     console.log(`⚠️ 跳过 TS 验证（可能是加密文件）`)
//     return data
//   }

//   // 标准 TS 验证
//   const possiblePacketSizes = [188, 192, 204]
//   let detectedPacketSize = null
//   let syncByteOffset = -1

//   for (let i = 0; i < Math.min(data.length, 4096); i++) {
//     if (data[i] === 0x47) {
//       for (const size of possiblePacketSizes) {
//         if (i + size < data.length && data[i + size] === 0x47) {
//           if (i + size * 2 < data.length && data[i + size * 2] === 0x47) {
//             detectedPacketSize = size
//             syncByteOffset = i
//             break
//           }
//         }
//       }
//       if (detectedPacketSize) break
//     }
//   }

//   if (!detectedPacketSize || syncByteOffset === -1) {
//     console.error("未找到有效的 TS 同步字节")
//     return null
//   }

//   let cleanedData = syncByteOffset === 0 ? data : data.slice(syncByteOffset)
//   const completePackets = Math.floor(cleanedData.length / detectedPacketSize)
//   const alignedLength = completePackets * detectedPacketSize

//   if (alignedLength < cleanedData.length) {
//     cleanedData = cleanedData.slice(0, alignedLength)
//   }

//   console.log(`✅ TS 验证通过: 包大小=${detectedPacketSize}, 包数=${completePackets}`)
//   return cleanedData
// }

// // --- 🔥 新增：解析 M3U8 获取加密信息 ---
// function parseM3U8 (m3u8Text, baseUrl) {
//   const lines = m3u8Text.split('\n')
//   const result = {
//     encrypted: false,
//     keyUri: null,
//     keyMethod: null,
//     keyIV: null,
//     segments: []
//   }

//   let currentKeyUri = null
//   let currentKeyIV = null

//   for (let i = 0; i < lines.length; i++) {
//     const line = lines[i].trim()

//     // 检测加密信息
//     if (line.startsWith('#EXT-X-KEY:')) {
//       result.encrypted = true

//       // 提取 METHOD
//       const methodMatch = line.match(/METHOD=([^,]+)/)
//       if (methodMatch) {
//         result.keyMethod = methodMatch[1]
//       }

//       // 提取 URI
//       const uriMatch = line.match(/URI="([^"]+)"/)
//       if (uriMatch) {
//         let keyUri = uriMatch[1]
//         // 🔥 关键修复：处理相对路径
//         if (!keyUri.startsWith('http://') && !keyUri.startsWith('https://')) {
//           keyUri = baseUrl + keyUri
//         }
//         currentKeyUri = keyUri
//         result.keyUri = keyUri
//         console.log(`🔑 密钥 URL: ${keyUri}`)
//       }

//       // 提取 IV
//       const ivMatch = line.match(/IV=(0x[0-9A-Fa-f]+)/)
//       if (ivMatch) {
//         currentKeyIV = ivMatch[1]
//         result.keyIV = currentKeyIV
//       }
//     }

//     // 收集分片 URL
//     if (line && !line.startsWith('#')) {
//       result.segments.push({
//         url: line,
//         keyUri: currentKeyUri,
//         keyIV: currentKeyIV
//       })
//     }
//   }

//   return result
// }

// // --- 更新：深度清洗（支持未加密的原始数据）---
// function deepCleanMergedTS (chunks, isEncrypted = false) {
//   console.log("🔍 开始处理合并数据...")

//   const validChunks = []
//   let totalValidSize = 0

//   for (let i = 0; i < chunks.length; i++) {
//     if (!chunks[i] || chunks[i].length === 0) continue

//     const cleaned = validateAndCleanTS(chunks[i], isEncrypted)
//     if (cleaned && cleaned.length > 0) {
//       validChunks.push(cleaned)
//       totalValidSize += cleaned.length
//     } else {
//       console.warn(`⚠️ 分片 ${i} 无效`)
//     }
//   }

//   console.log(`有效分片: ${validChunks.length}/${chunks.length}, 总大小: ${(totalValidSize / 1024 / 1024).toFixed(2)} MB`)

//   if (validChunks.length === 0) {
//     throw new Error("没有有效的分片数据")
//   }

//   const merged = new Uint8Array(totalValidSize)
//   let offset = 0

//   for (const chunk of validChunks) {
//     merged.set(chunk, offset)
//     offset += chunk.length
//   }

//   // 如果是加密文件，不进行 TS 格式验证
//   if (!isEncrypted && merged[0] !== 0x47) {
//     console.warn("⚠️ 合并后的文件头不是标准 TS 格式")
//   }

//   console.log("✅ 数据处理完成")
//   return merged
// }

// // --- 导出 TS ---
// async function saveTS (id) {
//   const chunks = taskChunks[id]
//   const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
//   const task = downloadQueue.find(t => t.id == id)

//   if (!chunks || chunks.length === 0) {
//     alert("没有可用的下载数据")
//     return
//   }

//   await updateTask(id, { status: '正在导出...', progress: 99 })

//   try {
//     // 检查是否为加密文件
//     const isEncrypted = task.encrypted || false

//     const cleanedData = deepCleanMergedTS(chunks, isEncrypted)
//     const finalBlob = new Blob([cleanedData], { type: 'video/mp2t' })

//     triggerDownload(finalBlob, task.title, 'ts')
//     await updateTask(id, { status: '✅ 已完成', progress: 100 })

//     delete taskChunks[id]

//   } catch (err) {
//     console.error("导出失败:", err)
//     alert(`导出失败: ${err.message}`)
//     await updateTask(id, { status: '❌ 导出失败' })
//   }
// }

// // --- MP4 转换 ---
// async function convertToMP4 (id) {
//   const chunks = taskChunks[id]
//   const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
//   const task = downloadQueue.find(t => t.id == id)

//   if (!chunks || !task) {
//     alert("数据加载失败")
//     return
//   }

//   try {
//     const totalSize = chunks.reduce((sum, c) => sum + (c ? c.byteLength : 0), 0)

//     if (totalSize > MEMORY_SAFE_LIMIT) {
//       const sizeMB = (totalSize / 1024 / 1024).toFixed(0)
//       if (confirm(`文件大小 ${sizeMB} MB，建议下载 TS 格式。是否继续？`)) {
//         await saveTS(id)
//       }
//       return
//     }

//     await updateTask(id, { status: '准备转码...', progress: 99 })

//     const isEncrypted = task.encrypted || false
//     const merged = deepCleanMergedTS(chunks, isEncrypted)

//     let ffmpeg = FFmpeg.createFFmpeg({
//       log: true,
//       corePath: chrome.runtime.getURL('lib/ffmpeg-core.js'),
//       mainName: 'main'
//     })

//     await ffmpeg.load()
//     ffmpeg.FS('writeFile', 'input.ts', merged)

//     await ffmpeg.run(
//       '-i', 'input.ts',
//       '-c:v', 'copy',
//       '-c:a', 'aac',
//       '-bsf:a', 'aac_adtstoasc',
//       '-movflags', '+faststart',
//       'output.mp4'
//     )

//     const data = ffmpeg.FS('readFile', 'output.mp4')
//     triggerDownload(new Blob([data.buffer], { type: 'video/mp4' }), task.title, 'mp4')
//     await updateTask(id, { status: '✅ 转换成功', progress: 100 })

//     delete taskChunks[id]
//     ffmpeg.exit()

//   } catch (err) {
//     console.error("转码失败:", err)
//     alert("转换失败，已改为导出 TS")
//     await saveTS(id)
//   }
// }

// // --- 🔥 更新：下载调度（支持加密文件）---
// async function downloadParallel (urls, taskId, signal, encryptionInfo) {
//   const CONCURRENCY = 6
//   const results = new Array(urls.length)
//   let currentIndex = 0
//   let downloadedBytes = 0
//   let failedCount = 0

//   const isEncrypted = encryptionInfo && encryptionInfo.encrypted

//   async function worker () {
//     while (currentIndex < urls.length) {
//       if (signal.aborted || deletedTasks.has(taskId)) return

//       const i = currentIndex++
//       const maxRetries = 3
//       let retryCount = 0

//       while (retryCount < maxRetries) {
//         try {
//           const segmentInfo = encryptionInfo?.segments?.[i]
//           const res = await fetch(urls[i], { signal })

//           if (!res.ok) throw new Error(`HTTP ${res.status}`)

//           let buf = await res.arrayBuffer()
//           if (buf.byteLength === 0) throw new Error("分片为空")

//           // 🔥 如果是加密文件，尝试解密
//           if (isEncrypted && segmentInfo?.keyUri) {
//             console.log(`🔓 解密分片 ${i}...`)
//             const decrypted = await decryptAES128(
//               buf,
//               segmentInfo.keyUri,
//               segmentInfo.keyIV,
//               i // 传入分片序号作为默认 IV
//             )
//             if (decrypted) {
//               buf = decrypted.buffer
//               console.log(`✅ 分片 ${i} 解密成功 (${decrypted.length} 字节)`)
//             } else {
//               console.warn(`⚠️ 分片 ${i} 解密失败，使用原始数据`)
//             }
//           }

//           // 验证（加密文件跳过 TS 格式验证）
//           const cleaned = validateAndCleanTS(buf, isEncrypted)

//           if (cleaned) {
//             results[i] = cleaned
//             downloadedBytes += cleaned.byteLength
//           } else {
//             if (!isEncrypted) {
//               console.warn(`分片 ${i} 验证失败`)
//               failedCount++
//             } else {
//               // 加密文件直接使用原始数据
//               results[i] = new Uint8Array(buf)
//               downloadedBytes += buf.byteLength
//             }
//           }

//           const finished = results.filter(r => r).length
//           if (finished % 30 === 0 || finished === urls.length) {
//             await updateTask(taskId, {
//               progress: Math.floor((finished / urls.length) * 100),
//               size: (downloadedBytes / (1024 * 1024)).toFixed(2),
//               status: `下载中 ${finished}/${urls.length}${isEncrypted ? ' 🔓' : ''}`
//             })
//           }

//           break

//         } catch (e) {
//           retryCount++
//           console.warn(`分片 ${i} 失败 (${retryCount}/${maxRetries}):`, e.message)

//           if (retryCount >= maxRetries) {
//             failedCount++
//             results[i] = null
//             break
//           }

//           if (!signal.aborted) {
//             await new Promise(r => setTimeout(r, 1000 * retryCount))
//           }
//         }
//       }
//     }
//   }

//   await Promise.all(Array(CONCURRENCY).fill(null).map(worker))

//   const successCount = results.filter(r => r && r.byteLength > 0).length
//   console.log(`📊 下载完成: ${successCount}/${urls.length}${isEncrypted ? ' (已解密)' : ''}`)

//   return results
// }

// // --- UI 渲染 ---
// function render () {
//   chrome.storage.local.get({ downloadQueue: [] }, (data) => {
//     const list = document.getElementById('tasks-list')
//     if (!list) return

//     list.innerHTML = data.downloadQueue.filter(t => !deletedTasks.has(t.id)).map(t => {
//       const isLarge = t.size && parseFloat(t.size) > 500
//       const isEncrypted = t.encrypted || false

//       return `
//         <div class="task-card">
//           <div style="display:flex; justify-content:space-between; align-items:center;">
//             <span style="font-weight:bold; color:#444; width:80%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
//               ${isEncrypted ? '🔒 ' : ''}${t.title}
//             </span>
//             <button class="action-btn-del" data-id="${t.id}" style="background:transparent; border:none; color:#ff3b30; font-size:24px; cursor:pointer;">×</button>
//           </div>
//           <div style="display:flex; align-items:center; gap:10px; margin:15px 0;">
//             <div style="flex:1; height:10px; background:#e0e5ec; border-radius:10px; overflow:hidden;">
//               <div style="width: ${t.progress || 0}%; height:100%; background:linear-gradient(90deg, #007aff, #00c7be);"></div>
//             </div>
//             <span style="font-size:12px; color:#666; font-weight:bold;">${t.progress || 0}%</span>
//           </div>
//           <div style="display:flex; justify-content:space-between; align-items:center;">
//             <div style="font-size:12px; color:#888;">
//               <span style="background:${t.status.includes('✅') ? '#28cd41' : t.status.includes('❌') ? '#ff3b30' : '#007aff'}; color:white; padding:2px 8px; border-radius:6px;">${t.status}</span>
//               ${t.size ? ` | 📦 ${t.size} MB` : ''}
//               ${isLarge ? ' ⚠️' : ''}
//             </div>
//             <div style="display:flex; gap:8px;">
//               ${t.status === '待保存' ? `
//                 <button class="btn action-btn-ts" data-id="${t.id}">导出 TS</button>
//                 ${!isLarge ? `<button class="btn action-btn-mp4" data-id="${t.id}">转 MP4</button>` : ''}
//               ` : (!t.status.includes('✅') && !t.status.includes('❌')) ? `
//                 <button class="btn action-btn-toggle" data-id="${t.id}">暂停</button>
//               ` : ''}
//             </div>
//           </div>
//         </div>
//       `
//     }).reverse().join('')
//   })
// }

// async function updateTask (id, obj) {
//   const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
//   const idx = downloadQueue.findIndex(t => t.id == id)
//   if (idx !== -1) {
//     downloadQueue[idx] = { ...downloadQueue[idx], ...obj }
//     await chrome.storage.local.set({ downloadQueue })
//     render()
//   }
// }

// // --- 🔥 更新：任务执行（解析加密信息）---
// async function executeTask (id) {
//   const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
//   const task = downloadQueue.find(t => t.id == id)
//   if (!task) return

//   const controller = new AbortController()
//   controllers[id] = controller

//   try {
//     await updateTask(id, { status: '解析资源...' })
//     const res = await fetch(task.url, { signal: controller.signal })
//     const text = await res.text()

//     // 🔥 计算 base URL（用于处理相对路径）
//     const baseUrl = task.url.substring(0, task.url.lastIndexOf('/') + 1)

//     // 🔥 解析 M3U8（包括加密信息，传入 baseUrl）
//     const m3u8Info = parseM3U8(text, baseUrl)

//     if (m3u8Info.encrypted) {
//       console.log(`🔒 检测到加密视频: ${m3u8Info.keyMethod}`)
//       console.log(`🔑 密钥位置: ${m3u8Info.keyUri}`)
//       await updateTask(id, { encrypted: true, keyMethod: m3u8Info.keyMethod })

//       if (m3u8Info.keyMethod !== 'AES-128' && m3u8Info.keyMethod !== 'NONE') {
//         alert(`⚠️ 检测到 ${m3u8Info.keyMethod} 加密，可能无法下载`)
//       }
//     }

//     const tsUrls = m3u8Info.segments.map(seg =>
//       seg.url.startsWith('http') ? seg.url : baseUrl + seg.url
//     )

//     console.log(`📝 解析到 ${tsUrls.length} 个分片${m3u8Info.encrypted ? ' (加密)' : ''}`)

//     const chunks = await downloadParallel(tsUrls, id, controller.signal, m3u8Info)

//     if (!deletedTasks.has(id)) {
//       taskChunks[id] = chunks
//       await updateTask(id, { status: '待保存', progress: 100 })
//     }
//   } catch (err) {
//     console.error("任务失败:", err)
//     if (!controller.signal.aborted) {
//       await updateTask(id, { status: '❌ 失败' })
//     }
//   } finally {
//     delete controllers[id]
//     activeCount--
//     scheduleNext()
//   }
// }

// async function scheduleNext () {
//   const { concurrency = 2 } = await chrome.storage.local.get('concurrency')
//   while (activeCount < concurrency && taskQueue.length > 0) {
//     activeCount++
//     executeTask(taskQueue.shift())
//   }
// }

// document.addEventListener('DOMContentLoaded', () => {
//   render()

//   document.getElementById('tasks-list').addEventListener('click', async (e) => {
//     const target = e.target.closest('button')
//     if (!target) return

//     const id = parseInt(target.dataset.id)

//     if (target.classList.contains('action-btn-ts')) {
//       saveTS(id)
//     } else if (target.classList.contains('action-btn-mp4')) {
//       convertToMP4(id)
//     } else if (target.classList.contains('action-btn-del')) {
//       deletedTasks.add(id)
//       if (controllers[id]) controllers[id].abort()
//       const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
//       await chrome.storage.local.set({ downloadQueue: downloadQueue.filter(x => x.id != id) })
//       delete taskChunks[id]
//       render()
//     }
//   })

//   const autoId = new URLSearchParams(window.location.search).get('autoId')
//   if (autoId) {
//     taskQueue.push(parseInt(autoId))
//     scheduleNext()
//   }
// })



// ------- new ---------

/** 🛠️ v6.2.0 支持加密视频检测和处理
 * 新增功能：
 * 1. 检测 M3U8 中的加密信息（#EXT-X-KEY）
 * 2. 自动解密 AES-128 加密的 TS 分片
 * 3. 更宽松的 TS 验证（兼容非标准格式）
 * 4. 提供原始文件导出选项
 */

const _createObjectURL = URL.createObjectURL
URL.createObjectURL = function (obj) {
  if (obj instanceof Blob && (obj.type.includes('javascript') || obj.type === '')) {
    const scriptText = `self.importScripts("${chrome.runtime.getURL('lib/ffmpeg-core.js')}");`
    return _createObjectURL.call(URL, new Blob([scriptText], { type: 'application/javascript' }))
  }
  return _createObjectURL.call(URL, obj)
}

let activeCount = 0
let taskQueue = []
const taskChunks = {}
const controllers = {}
const deletedTasks = new Set()
const encryptionKeys = {} // 存储解密密钥

const LARGE_FILE_THRESHOLD = 500 * 1024 * 1024
const MEMORY_SAFE_LIMIT = 800 * 1024 * 1024  // 🔥 提升到 800MB，支持更大文件转换

// --- 🔥 新增：通知函数 ---
function showNotification (title, message, type = 'info') {
  // 尝试使用浏览器通知（处理 icon 缺失问题）
  if ('Notification' in window && Notification.permission === 'granted') {
    const icon = type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️'
    try {
      new Notification(`${icon} ${title}`, {
        body: message,
        requireInteraction: false
      })
    } catch (e) {
      console.log('浏览器通知创建失败:', e)
    }
  }

  // 同时显示页面内通知
  const notification = document.createElement('div')
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'success' ? '#28cd41' : type === 'warning' ? '#ff9500' : '#007aff'};
    color: white;
    padding: 16px 24px;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.15);
    z-index: 10000;
    font-size: 14px;
    font-weight: 600;
    max-width: 320px;
    animation: slideIn 0.3s ease;
  `
  notification.innerHTML = `
    <div style="font-size: 16px; margin-bottom: 4px;">${title}</div>
    <div style="opacity: 0.9; font-weight: normal;">${message}</div>
  `
  document.body.appendChild(notification)

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease'
    setTimeout(() => notification.remove(), 300)
  }, 4000)
}

// 添加动画样式
if (!document.getElementById('notification-styles')) {
  const style = document.createElement('style')
  style.id = 'notification-styles'
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(400px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(400px); opacity: 0; }
    }
  `
  document.head.appendChild(style)
}

// 请求通知权限
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission()
}

function triggerDownload (blob, baseName, extension) {
  const safeTitle = baseName.replace(/[\\/:*?"<>|]/g, "_")
  const finalFileName = `${safeTitle}.${extension}`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = finalFileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

// --- 🔥 新增：AES-128 解密函数 ---
async function decryptAES128 (encryptedData, keyUri, iv, segmentIndex = 0) {
  try {
    console.log(`🔐 正在获取密钥: ${keyUri}`)

    // 获取密钥
    let keyData
    if (encryptionKeys[keyUri]) {
      keyData = encryptionKeys[keyUri]
      console.log(`✅ 使用缓存的密钥`)
    } else {
      const keyResponse = await fetch(keyUri)
      if (!keyResponse.ok) {
        throw new Error(`密钥获取失败: HTTP ${keyResponse.status}`)
      }
      const keyBuffer = await keyResponse.arrayBuffer()
      keyData = new Uint8Array(keyBuffer)
      encryptionKeys[keyUri] = keyData
      console.log(`🔑 密钥已获取并缓存 (${keyData.length} 字节)`)
    }

    // 导入密钥
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'AES-CBC', length: 128 },
      false,
      ['decrypt']
    )

    // IV 处理
    let ivBuffer
    if (iv) {
      // 解析 hex IV (格式: 0x12345678...)
      const ivHex = iv.replace('0x', '').replace('0X', '')
      ivBuffer = new Uint8Array(ivHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)))
      console.log(`使用提供的 IV: ${iv}`)
    } else {
      // 使用分片序号作为 IV（HLS 标准）
      ivBuffer = new Uint8Array(16)
      const view = new DataView(ivBuffer.buffer)
      view.setUint32(12, segmentIndex, false) // big-endian
      console.log(`使用序号作为 IV: ${segmentIndex}`)
    }

    // 解密
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-CBC', iv: ivBuffer },
      key,
      encryptedData
    )

    return new Uint8Array(decrypted)
  } catch (err) {
    console.error(`❌ 解密失败:`, err)
    return null
  }
}

// --- 🔥 更新：宽松的 TS 验证（支持加密前的数据）---
function validateAndCleanTS (buffer, skipValidation = false) {
  const data = new Uint8Array(buffer)

  if (data.length === 0) {
    return null
  }

  // 如果跳过验证（加密文件），直接返回
  if (skipValidation) {
    console.log(`⚠️ 跳过 TS 验证（可能是加密文件）`)
    return data
  }

  // 标准 TS 验证
  const possiblePacketSizes = [188, 192, 204]
  let detectedPacketSize = null
  let syncByteOffset = -1

  for (let i = 0; i < Math.min(data.length, 4096); i++) {
    if (data[i] === 0x47) {
      for (const size of possiblePacketSizes) {
        if (i + size < data.length && data[i + size] === 0x47) {
          if (i + size * 2 < data.length && data[i + size * 2] === 0x47) {
            detectedPacketSize = size
            syncByteOffset = i
            break
          }
        }
      }
      if (detectedPacketSize) break
    }
  }

  if (!detectedPacketSize || syncByteOffset === -1) {
    console.error("未找到有效的 TS 同步字节")
    return null
  }

  let cleanedData = syncByteOffset === 0 ? data : data.slice(syncByteOffset)
  const completePackets = Math.floor(cleanedData.length / detectedPacketSize)
  const alignedLength = completePackets * detectedPacketSize

  if (alignedLength < cleanedData.length) {
    cleanedData = cleanedData.slice(0, alignedLength)
  }

  console.log(`✅ TS 验证通过: 包大小=${detectedPacketSize}, 包数=${completePackets}`)
  return cleanedData
}

// --- 🔥 新增：解析 M3U8 获取加密信息 ---
function parseM3U8 (m3u8Text, baseUrl) {
  const lines = m3u8Text.split('\n')
  const result = {
    encrypted: false,
    keyUri: null,
    keyMethod: null,
    keyIV: null,
    segments: []
  }

  let currentKeyUri = null
  let currentKeyIV = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // 检测加密信息
    if (line.startsWith('#EXT-X-KEY:')) {
      result.encrypted = true

      // 提取 METHOD
      const methodMatch = line.match(/METHOD=([^,]+)/)
      if (methodMatch) {
        result.keyMethod = methodMatch[1]
      }

      // 提取 URI
      const uriMatch = line.match(/URI="([^"]+)"/)
      if (uriMatch) {
        let keyUri = uriMatch[1]
        // 🔥 关键修复：处理相对路径
        if (!keyUri.startsWith('http://') && !keyUri.startsWith('https://')) {
          keyUri = baseUrl + keyUri
        }
        currentKeyUri = keyUri
        result.keyUri = keyUri
        console.log(`🔑 密钥 URL: ${keyUri}`)
      }

      // 提取 IV
      const ivMatch = line.match(/IV=(0x[0-9A-Fa-f]+)/)
      if (ivMatch) {
        currentKeyIV = ivMatch[1]
        result.keyIV = currentKeyIV
      }
    }

    // 收集分片 URL
    if (line && !line.startsWith('#')) {
      result.segments.push({
        url: line,
        keyUri: currentKeyUri,
        keyIV: currentKeyIV
      })
    }
  }

  return result
}

// --- 更新：深度清洗（支持未加密的原始数据）---
function deepCleanMergedTS (chunks, isEncrypted = false) {
  console.log("🔍 开始处理合并数据...")

  const validChunks = []
  let totalValidSize = 0

  for (let i = 0; i < chunks.length; i++) {
    if (!chunks[i] || chunks[i].length === 0) continue

    const cleaned = validateAndCleanTS(chunks[i], isEncrypted)
    if (cleaned && cleaned.length > 0) {
      validChunks.push(cleaned)
      totalValidSize += cleaned.length
    } else {
      console.warn(`⚠️ 分片 ${i} 无效`)
    }
  }

  console.log(`有效分片: ${validChunks.length}/${chunks.length}, 总大小: ${(totalValidSize / 1024 / 1024).toFixed(2)} MB`)

  if (validChunks.length === 0) {
    throw new Error("没有有效的分片数据")
  }

  const merged = new Uint8Array(totalValidSize)
  let offset = 0

  for (const chunk of validChunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }

  // 如果是加密文件，不进行 TS 格式验证
  if (!isEncrypted && merged[0] !== 0x47) {
    console.warn("⚠️ 合并后的文件头不是标准 TS 格式")
  }

  console.log("✅ 数据处理完成")
  return merged
}

// --- 导出 TS ---
async function saveTS (id) {
  const chunks = taskChunks[id]
  const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
  const task = downloadQueue.find(t => t.id == id)

  if (!chunks || chunks.length === 0) {
    alert("没有可用的下载数据")
    return
  }

  await updateTask(id, { status: '正在导出...', progress: 99 })

  try {
    // 检查是否为加密文件
    const isEncrypted = task.encrypted || false

    const cleanedData = deepCleanMergedTS(chunks, isEncrypted)
    const finalBlob = new Blob([cleanedData], { type: 'video/mp2t' })

    triggerDownload(finalBlob, task.title, 'ts')
    await updateTask(id, { status: '✅ 已完成', progress: 100 })

    delete taskChunks[id]

  } catch (err) {
    console.error("导出失败:", err)
    alert(`导出失败: ${err.message}`)
    await updateTask(id, { status: '❌ 导出失败' })
  }
}

// --- MP4 转换 ---
async function convertToMP4 (id) {
  const chunks = taskChunks[id]
  const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
  const task = downloadQueue.find(t => t.id == id)

  if (!chunks || !task) {
    alert("数据加载失败")
    return
  }

  try {
    const totalSize = chunks.reduce((sum, c) => sum + (c ? c.byteLength : 0), 0)

    if (totalSize > MEMORY_SAFE_LIMIT) {
      const sizeMB = (totalSize / 1024 / 1024).toFixed(0)
      if (confirm(`文件大小 ${sizeMB} MB，建议下载 TS 格式。是否继续？`)) {
        await saveTS(id)
      }
      return
    }

    await updateTask(id, { status: '准备转码...', progress: 99 })

    const isEncrypted = task.encrypted || false
    const merged = deepCleanMergedTS(chunks, isEncrypted)

    let ffmpeg = FFmpeg.createFFmpeg({
      log: true,
      corePath: chrome.runtime.getURL('lib/ffmpeg-core.js'),
      mainName: 'main'
    })

    await ffmpeg.load()
    ffmpeg.FS('writeFile', 'input.ts', merged)

    await ffmpeg.run(
      '-i', 'input.ts',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-bsf:a', 'aac_adtstoasc',
      '-movflags', '+faststart',
      'output.mp4'
    )

    const data = ffmpeg.FS('readFile', 'output.mp4')
    triggerDownload(new Blob([data.buffer], { type: 'video/mp4' }), task.title, 'mp4')
    await updateTask(id, { status: '✅ 转换成功', progress: 100 })

    delete taskChunks[id]
    ffmpeg.exit()

  } catch (err) {
    console.error("转码失败:", err)
    alert("转换失败，已改为导出 TS")
    await saveTS(id)
  }
}

// --- 🔥 更新：下载调度（支持加密文件）---
async function downloadParallel (urls, taskId, signal, encryptionInfo) {
  const CONCURRENCY = 6
  const results = new Array(urls.length)
  let currentIndex = 0
  let downloadedBytes = 0
  let failedCount = 0

  const isEncrypted = encryptionInfo && encryptionInfo.encrypted

  async function worker () {
    while (currentIndex < urls.length) {
      if (signal.aborted || deletedTasks.has(taskId)) return

      const i = currentIndex++
      const maxRetries = 3
      let retryCount = 0

      while (retryCount < maxRetries) {
        try {
          const segmentInfo = encryptionInfo?.segments?.[i]
          const res = await fetch(urls[i], { signal })

          if (!res.ok) throw new Error(`HTTP ${res.status}`)

          let buf = await res.arrayBuffer()
          if (buf.byteLength === 0) throw new Error("分片为空")

          // 🔥 如果是加密文件，尝试解密
          if (isEncrypted && segmentInfo?.keyUri) {
            console.log(`🔓 解密分片 ${i}...`)
            const decrypted = await decryptAES128(
              buf,
              segmentInfo.keyUri,
              segmentInfo.keyIV,
              i // 传入分片序号作为默认 IV
            )
            if (decrypted) {
              buf = decrypted.buffer
              console.log(`✅ 分片 ${i} 解密成功 (${decrypted.length} 字节)`)
            } else {
              console.warn(`⚠️ 分片 ${i} 解密失败，使用原始数据`)
            }
          }

          // 验证（加密文件跳过 TS 格式验证）
          const cleaned = validateAndCleanTS(buf, isEncrypted)

          if (cleaned) {
            results[i] = cleaned
            downloadedBytes += cleaned.byteLength
          } else {
            if (!isEncrypted) {
              console.warn(`分片 ${i} 验证失败`)
              failedCount++
            } else {
              // 加密文件直接使用原始数据
              results[i] = new Uint8Array(buf)
              downloadedBytes += buf.byteLength
            }
          }

          const finished = results.filter(r => r).length
          if (finished % 30 === 0 || finished === urls.length) {
            await updateTask(taskId, {
              progress: Math.floor((finished / urls.length) * 100),
              size: (downloadedBytes / (1024 * 1024)).toFixed(2),
              status: `下载中 ${finished}/${urls.length}${isEncrypted ? ' 🔓' : ''}`
            })
          }

          break

        } catch (e) {
          retryCount++
          console.warn(`分片 ${i} 失败 (${retryCount}/${maxRetries}):`, e.message)

          if (retryCount >= maxRetries) {
            failedCount++
            results[i] = null
            break
          }

          if (!signal.aborted) {
            await new Promise(r => setTimeout(r, 1000 * retryCount))
          }
        }
      }
    }
  }

  await Promise.all(Array(CONCURRENCY).fill(null).map(worker))

  const successCount = results.filter(r => r && r.byteLength > 0).length
  console.log(`📊 下载完成: ${successCount}/${urls.length}${isEncrypted ? ' (已解密)' : ''}`)

  return results
}

// --- 🔥 必须在 executeTask 之前定义所有被调用的函数 ---

// --- 导出 TS ---
async function saveTS (id) {
  const chunks = taskChunks[id]
  const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
  const task = downloadQueue.find(t => t.id == id)

  if (!chunks || chunks.length === 0) {
    alert("没有可用的下载数据")
    return
  }

  await updateTask(id, { status: '正在导出...', progress: 99 })

  try {
    const isEncrypted = task.encrypted || false
    const cleanedData = deepCleanMergedTS(chunks, isEncrypted)
    const finalBlob = new Blob([cleanedData], { type: 'video/mp2t' })

    triggerDownload(finalBlob, task.title, 'ts')
    await updateTask(id, { status: '✅ 已完成', progress: 100 })

    delete taskChunks[id]

  } catch (err) {
    console.error("导出失败:", err)
    alert(`导出失败: ${err.message}`)
    await updateTask(id, { status: '❌ 导出失败' })
  }
}

// --- 🔥 自动转换 MP4（失败时自动保存 TS）---
async function autoConvertToMP4 (id) {
  const chunks = taskChunks[id]
  const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
  const task = downloadQueue.find(t => t.id == id)

  if (!chunks || !task) {
    console.error('autoConvertToMP4: 数据缺失')
    return
  }

  let ffmpeg = null

  try {
    await updateTask(id, { status: '🎬 转换 MP4...', progress: 99 })

    const isEncrypted = task.encrypted || false
    const merged = deepCleanMergedTS(chunks, isEncrypted)

    ffmpeg = FFmpeg.createFFmpeg({
      log: true,
      corePath: chrome.runtime.getURL('lib/ffmpeg-core.js'),
      mainName: 'main'
    })

    await ffmpeg.load()
    ffmpeg.FS('writeFile', 'input.ts', merged)

    await ffmpeg.run(
      '-i', 'input.ts',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-bsf:a', 'aac_adtstoasc',
      '-movflags', '+faststart',
      'output.mp4'
    )

    const data = ffmpeg.FS('readFile', 'output.mp4')
    triggerDownload(new Blob([data.buffer], { type: 'video/mp4' }), task.title, 'mp4')
    await updateTask(id, { status: '✅ MP4 完成', progress: 100 })

    showNotification('转换成功', `${task.title} 已保存为 MP4`, 'success')

    delete taskChunks[id]
    if (ffmpeg) ffmpeg.exit()

  } catch (err) {
    console.error("MP4 转换失败，自动保存为 TS:", err)

    if (ffmpeg) {
      try { ffmpeg.exit() } catch (e) { }
    }

    await saveTS(id)
    showNotification('已保存 TS', `${task.title} 转换失败，已保存为 TS 格式`, 'warning')
  }
}

// --- MP4 转换（手动触发）---
async function convertToMP4 (id) {
  const chunks = taskChunks[id]
  const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
  const task = downloadQueue.find(t => t.id == id)

  if (!chunks || !task) {
    alert("数据加载失败")
    return
  }

  try {
    const totalSize = chunks.reduce((sum, c) => sum + (c ? c.byteLength : 0), 0)

    if (totalSize > MEMORY_SAFE_LIMIT) {
      const sizeMB = (totalSize / 1024 / 1024).toFixed(0)
      if (confirm(`文件大小 ${sizeMB} MB，建议下载 TS 格式。是否继续？`)) {
        await saveTS(id)
      }
      return
    }

    await autoConvertToMP4(id)

  } catch (err) {
    console.error("转码失败:", err)
    alert("转换失败，已改为导出 TS")
    await saveTS(id)
  }
}

// --- UI 渲染 ---
function render () {
  chrome.storage.local.get({ downloadQueue: [] }, (data) => {
    const list = document.getElementById('tasks-list')
    if (!list) return

    list.innerHTML = data.downloadQueue.filter(t => !deletedTasks.has(t.id)).map(t => {
      const isLarge = t.size && parseFloat(t.size) > 500
      const isEncrypted = t.encrypted || false

      return `
        <div class="task-card">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:bold; color:#444; width:80%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
              ${isEncrypted ? '🔒 ' : ''}${t.title}
            </span>
            <button class="action-btn-del" data-id="${t.id}" style="background:transparent; border:none; color:#ff3b30; font-size:24px; cursor:pointer;">×</button>
          </div>
          <div style="display:flex; align-items:center; gap:10px; margin:15px 0;">
            <div style="flex:1; height:10px; background:#e0e5ec; border-radius:10px; overflow:hidden;">
              <div style="width: ${t.progress || 0}%; height:100%; background:linear-gradient(90deg, #007aff, #00c7be);"></div>
            </div>
            <span style="font-size:12px; color:#666; font-weight:bold;">${t.progress || 0}%</span>
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size:12px; color:#888;">
              <span style="background:${t.status.includes('✅') ? '#28cd41' : t.status.includes('❌') ? '#ff3b30' : '#007aff'}; color:white; padding:2px 8px; border-radius:6px;">${t.status}</span>
              ${t.size ? ` | 📦 ${t.size} MB` : ''}
              ${isLarge ? ' ⚠️' : ''}
            </div>
            <div style="display:flex; gap:8px;">
              ${t.status === '待保存' ? `
                <button class="btn action-btn-ts" data-id="${t.id}">导出 TS</button>
                ${!isLarge ? `<button class="btn action-btn-mp4" data-id="${t.id}">转 MP4</button>` : ''}
              ` : (!t.status.includes('✅') && !t.status.includes('❌')) ? `
                <button class="btn action-btn-toggle" data-id="${t.id}">暂停</button>
              ` : ''}
            </div>
          </div>
        </div>
      `
    }).reverse().join('')
  })
}

async function updateTask (id, obj) {
  const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
  const idx = downloadQueue.findIndex(t => t.id == id)
  if (idx !== -1) {
    downloadQueue[idx] = { ...downloadQueue[idx], ...obj }
    await chrome.storage.local.set({ downloadQueue })
    render()
  }
}

// --- 🔥 更新：任务执行（解析加密信息）---
async function executeTask (id) {
  const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
  const task = downloadQueue.find(t => t.id == id)
  if (!task) return

  const controller = new AbortController()
  controllers[id] = controller

  try {
    await updateTask(id, { status: '解析资源...' })
    const res = await fetch(task.url, { signal: controller.signal })
    const text = await res.text()

    // 🔥 计算 base URL（用于处理相对路径）
    const baseUrl = task.url.substring(0, task.url.lastIndexOf('/') + 1)

    // 🔥 解析 M3U8（包括加密信息，传入 baseUrl）
    const m3u8Info = parseM3U8(text, baseUrl)

    if (m3u8Info.encrypted) {
      console.log(`🔒 检测到加密视频: ${m3u8Info.keyMethod}`)
      console.log(`🔑 密钥位置: ${m3u8Info.keyUri}`)
      await updateTask(id, { encrypted: true, keyMethod: m3u8Info.keyMethod })

      if (m3u8Info.keyMethod !== 'AES-128' && m3u8Info.keyMethod !== 'NONE') {
        alert(`⚠️ 检测到 ${m3u8Info.keyMethod} 加密，可能无法下载`)
      }
    }

    const tsUrls = m3u8Info.segments.map(seg =>
      seg.url.startsWith('http') ? seg.url : baseUrl + seg.url
    )

    console.log(`📝 解析到 ${tsUrls.length} 个分片${m3u8Info.encrypted ? ' (加密)' : ''}`)

    const chunks = await downloadParallel(tsUrls, id, controller.signal, m3u8Info)

    if (!deletedTasks.has(id)) {
      taskChunks[id] = chunks
      await updateTask(id, { status: '待保存', progress: 100 })

      // 🔥 检查用户设置
      const { autoConvertMP4 = true, convertSizeLimit = 800 } = await chrome.storage.local.get(['autoConvertMP4', 'convertSizeLimit'])

      const totalSize = chunks.reduce((sum, c) => sum + (c ? c.byteLength : 0), 0)
      const sizeMB = (totalSize / 1024 / 1024).toFixed(2)
      const limitBytes = convertSizeLimit * 1024 * 1024

      console.log(`📦 文件 ${sizeMB} MB，自动转换 MP4（限制 ${convertSizeLimit} MB）`)

      // 判断是否自动转换
      if (autoConvertMP4 && totalSize < limitBytes) {
        console.log(`✅ 开始自动转换 MP4`)
        showNotification('开始转换', `正在将 ${task.title} 转换为 MP4 格式...`, 'info')
        setTimeout(() => {
          console.log(`调用 autoConvertToMP4(${id})`)
          autoConvertToMP4(id).catch(err => {
            console.error('autoConvertToMP4 执行错误:', err)
            saveTS(id)
          })
        }, 500)
      } else {
        const reason = !autoConvertMP4 ? '已关闭自动转换' : `超过 ${convertSizeLimit} MB 限制`
        console.log(`📦 保存 TS（${reason}）`)
        showNotification('已保存 TS', `${task.title} - ${reason}`, 'info')
        setTimeout(() => {
          saveTS(id)
        }, 500)
      }
    }
  } catch (err) {
    console.error("任务失败:", err)
    if (!controller.signal.aborted) {
      await updateTask(id, { status: '❌ 失败' })
    }
  } finally {
    delete controllers[id]
    activeCount--
    scheduleNext()
  }
}

async function scheduleNext () {
  const { concurrency = 2 } = await chrome.storage.local.get('concurrency')
  while (activeCount < concurrency && taskQueue.length > 0) {
    activeCount++
    executeTask(taskQueue.shift())
  }
}

document.addEventListener('DOMContentLoaded', () => {
  render()

  // 🔥 新增：加载用户设置
  chrome.storage.local.get({
    autoConvertMP4: true,  // 默认开启自动转换
    convertSizeLimit: 800  // 默认 800MB
  }, (settings) => {
    const autoConvertCheckbox = document.getElementById('auto-convert-mp4')
    const sizeLimitInput = document.getElementById('convert-size-limit')

    if (autoConvertCheckbox) {
      autoConvertCheckbox.checked = settings.autoConvertMP4
      autoConvertCheckbox.onchange = () => {
        chrome.storage.local.set({ autoConvertMP4: autoConvertCheckbox.checked })
        console.log('自动转换设置:', autoConvertCheckbox.checked)
      }
    }

    if (sizeLimitInput) {
      sizeLimitInput.value = settings.convertSizeLimit
      sizeLimitInput.onchange = () => {
        const newLimit = parseInt(sizeLimitInput.value) || 800
        const clampedLimit = Math.max(100, Math.min(2000, newLimit))
        sizeLimitInput.value = clampedLimit
        chrome.storage.local.set({ convertSizeLimit: clampedLimit })
        console.log('转换大小限制:', clampedLimit, 'MB')
      }
    }
  })

  // 🔥 修复：清空已完成按钮
  document.getElementById('clear-all')?.addEventListener('click', async () => {
    const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')

    // 过滤掉已完成的任务
    const remaining = downloadQueue.filter(t =>
      !t.status.includes('✅') && !t.status.includes('完成')
    )

    const clearedCount = downloadQueue.length - remaining.length

    if (clearedCount > 0) {
      await chrome.storage.local.set({ downloadQueue: remaining })
      render()
      showNotification('已清空', `已清除 ${clearedCount} 个完成任务`, 'success')
      console.log(`清空了 ${clearedCount} 个已完成任务`)
    } else {
      showNotification('无需清空', '没有已完成的任务', 'info')
    }
  })

  document.getElementById('tasks-list').addEventListener('click', async (e) => {
    const target = e.target.closest('button')
    if (!target) return

    const id = parseInt(target.dataset.id)

    if (target.classList.contains('action-btn-ts')) {
      saveTS(id)
    } else if (target.classList.contains('action-btn-mp4')) {
      convertToMP4(id)
    } else if (target.classList.contains('action-btn-del')) {
      deletedTasks.add(id)
      if (controllers[id]) controllers[id].abort()
      const { downloadQueue = [] } = await chrome.storage.local.get('downloadQueue')
      await chrome.storage.local.set({ downloadQueue: downloadQueue.filter(x => x.id != id) })
      delete taskChunks[id]
      render()
      showNotification('已删除', '任务已删除', 'info')
    }
  })

  const autoId = new URLSearchParams(window.location.search).get('autoId')
  if (autoId) {
    taskQueue.push(parseInt(autoId))
    scheduleNext()
  }
})