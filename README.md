# 💎 视频专家 Pro (M3U8 视频下载利器)

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Chrome%20|%20Edge-green.svg)](https://www.google.com/chrome/)

这是一款基于 Chrome 扩展 V3 架构的高级 M3U8 视频下载工具。它内置了 **FFmpeg.wasm** 核心，能够在浏览器端直接将下载的 TS 分片封装为 MP4 格式，并提供精美的**拟物化 (Neumorphism)** 交互界面。



## ✨ 核心功能

* **智能嗅探**：自动捕获网页中的 M3U8 资源，支持多层级流解析。
* **FFmpeg 高级封装**：无需安装客户端，直接在浏览器内将 TS 合并并转码为 MP4。
* **并发下载控制**：内置任务调度队列，可自由设置同时下载的任务数，保护系统内存。
* **广告智能过滤**：自动识别并剔除视频流中的片段式广告。
* **拟物化 UI**：非扁平化设计，提供具有视觉深度的任务管理面板。
* **Worker 多线程修复**：针对 Chrome 插件环境优化的多线程解决方案。

## 🛠️ 安装说明

1.  **下载源码**：点击 `Code` -> `Download ZIP` 或使用 `git clone`。
2.  **解压文件**：将下载的压缩包解压到本地文件夹。
3.  **载入插件**：
    * 打开 Chrome 浏览器，访问 `chrome://extensions/`。
    * 右上角开启 **开发者模式 (Developer mode)**。
    * 点击左上角 **加载已解压的扩展程序 (Load unpacked)**。
    * 选择本项目文件夹。
4.  **注意**：由于使用了跨域隔离技术，请确保在插件管理中心允许该插件。

## 🚀 使用指南

1.  打开任意含有视频播放器的网页。
2.  点击浏览器工具栏中的插件图标。
3.  在弹出的列表中选择想要下载的资源，点击 **"下载 MP4"**。
4.  插件会自动跳转至**下载管理中心**。
5.  在页面顶部可以设置 **⚡ 同时下载任务数** 以平衡系统性能。

## 📂 文件结构

```text
├── manifest.json         # 扩展配置文件 (V3)
├── background.js         # 后台资源监控逻辑
├── popup.html/js         # 弹窗交互界面
├── download.html/js      # 下载管理中心核心逻辑
└── lib/                  # 核心库文件
    ├── ffmpeg.min.js     # FFmpeg 调度器
    ├── ffmpeg-core.js    # FFmpeg 核心
    ├── ffmpeg-core.wasm  # WebAssembly 静态资源
    └── ffmpeg-core.worker.js # 多线程支持脚本
