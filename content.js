chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "captureSnapshot") {
    // 查找当前页面上最有可能是视频的元素
    const video = document.querySelector('video') ||
      Array.from(document.querySelectorAll('video')).find(v => v.readyState > 0)

    if (!video || video.videoWidth === 0) {
      sendResponse({ success: false, error: "未找到活跃视频" })
      return
    }

    try {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = (video.videoHeight / video.videoWidth) * 320
      const ctx = canvas.getContext('2d')
      // 关键：处理可能的跨域画面限制
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
      sendResponse({ success: true, snapshot: dataUrl })
    } catch (e) {
      sendResponse({ success: false, error: "Canvas 截图受限" })
    }
  }
  return true
})