# LiveBox

Chrome / Edge 的 Manifest V3 直播订阅扩展，支持哔哩哔哩、虎牙和斗鱼。

## 功能

- 直播间订阅、卡片聚合、搜索与平台筛选。
- 定时检查开播状态，发生“未开播 → 直播中”变化时提醒。
- 独立浏览器小窗观看，支持设置窗口尺寸。
- B站关注导入、订阅 JSON 导入导出。
- 本地保存订阅和设置；网络失败显示状态未知。

## 安装

1. 在 [Release](https://github.com/ZhouyFire/LiveBox/releases/tag/v0.1.0.0) 下载 CRX 或 ZIP；使用 ZIP 时先解压。
2. 打开 chrome://extensions 或 edge://extensions，启用开发人员模式。
3. 选择“加载解压缩的扩展”，选中 extension/ 或解压后包含 manifest.json 的文件夹。
4. 点击扩展图标 → 管理订阅，添加直播间网址，再检查状态。

首次成功检查只建立状态基线。默认每 3 分钟检查，最多保存 100 个直播间；可在设置中关闭自动检查与通知。小窗打开平台原始房间页面。

当前扩展版本为 0.1.0.0。CRX 能否直接安装取决于浏览器的分发策略；若受限制，可使用 ZIP 解压后的目录按上面的步骤加载。

B站关注导入需要当前浏览器已有登录态。平台接口、访问策略和浏览器 Cookie 设置可能影响请求；播放器能否播放取决于平台页面与浏览器环境。

## 开发

运行扩展无需构建或安装第三方依赖。开发检查需要 Node.js 20+，打包需要 Python 3。

    npm test
    npm run check
    npm run package

可选浏览器测试使用已有的 playwright-core：

    node scripts/browser-smoke.mjs <playwright-core-directory> [edge-executable]

测试使用独立临时浏览器配置，生成文件保存在已忽略的 .runtime/artifacts/。
