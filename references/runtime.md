# HyperFrames 与 Three.js 的接入

本模板验证基线：2026-11-04，Node.js 22.22.2、HyperFrames 0.9.10、Three.js 0.187.0。官方仓库和 npm 发布版本可能前进；修改时先核对项目锁文件与安装版本，避免照搬主分支的新接口。

## 合成契约

- `index.html` 的根元素提供 `data-composition-id`、`data-start="0"`、`data-duration`、`data-width`、`data-height`、`data-fps`。修改 `scene.json` 的时长/画幅/帧率后运行 `npm run validate` 同步根元素，避免渲染器在脚本加载前读到旧元数据。
- Three.js 监听 `window` 的 `hf-seek`，从 `event.detail.time` 调用统一的 `renderAt(t)`。不要自造不存在的 HyperFrames 导出 API。
- 0.9.10 的纯 Three.js 模板初始化空 `window.__timelines` 注册表，并在根元素声明 `data-no-timeline`，表示没有 GSAP 时间线。时长由根元素提供，画面仍由 `hf-seek` 驱动，已用实际逐帧导出验证；不伪造 GSAP 时间线。
- 注册 `window.__hf.buildReady.previs` 承诺，资源和场景初始化、首帧完成后再 resolve。异步逐帧工作需在事件监听函数中同步调用 `event.detail.waitUntil(promise)`；不要把 `waitUntil` 推迟到 `await` 后。
- 首帧必须已完整绘制。WebGL 渲染使用 `preserveDrawingBuffer: true`；异步纹理和外部模型必须包含在 readiness 中。
- 依赖从本地 `lib/` 加载，模板的 `prepare-libs.mjs` 从锁定 npm 包复制 Three.js 模块、核心、OrbitControls 和许可证。离线预览不依赖 CDN。
- `studio.html` 在独立页面承载控件，嵌入干净入口。只有审片页使用播放计时；HyperFrames 导出由 `hf-seek` 驱动。开启自由观察不会影响正式机位数据。

## 验证与导出

0.4.0 使用 `PREVIS_RENDER_CONTENT_V2`：`scene_sha256` 为规范化渲染内容哈希，排除顶层 editLocks/editorHistory，`scene_file_sha256` 保留原始文件取证。sourceFingerprint 的 scene.json 条目用同一渲染投影；保存仍使用原始文件 revision。写锁、历史和批注不使像素证据无故过期；改实质轨迹、人物、材质或脚本仍过期。旧回执缺少该身份字段时需要真实重新导出，不手工改哈希续用。

`npm run render` 记录渲染源与资产指纹，返回包据此判断视频是否过期。默认追踪入口、场景、包锁和 `src/lib/assets/models/textures/fonts/media/audio/shaders`，并追踪 `assetBindings[].appearanceReference`。根目录自定义脚本、外部素材等要显式加入 `scene.renderDependencies`；优先将资源放在项目中，远程 URL 需先本地化，保证导出可复现。

在项目目录运行 `npm run validate`、`npm run lint`、`npm run snapshot` 和 `npm run render`。模板默认用单 worker 导出 24fps MP4，减少多个 WebGL 上下文的资源争用。

`npm run spatial-check` 保存按样本帧的代理检查证据；`npm run feedback` 导出当前批注和过期状态。空间报告必须与当前渲染内容/intake关联，返回包才引用；它的 NO_ISSUES_OBSERVED 不是 MEDIA PASS。

首次运行如缺 Chrome，用 `npx hyperframes browser ensure`。若 WebGL 在宿主 GPU 上失败，可尝试 `npm run render -- --no-browser-gpu`，随后检查实际帧。使用渲染包装命令才能获得输入关联回执；直接运行底层 CLI 的视频仍需重新核对关联，不手改回执冒充已验证。

导出先进入独立暂存 MP4，检查来源未变，并在 `ffprobe` 可用时检查时长、尺寸、fps 和实际帧数，再发布视频与回执。失败保留上一次成功视频；失败尝试写在 `renders/render-attempt.json`，不与成功回执混淆。缺少 ffprobe 时 `media_metrics_status=NOT_RUN`，不得声称已完成格式探测。项目锁避免同项目多次导出互相覆盖。

审片保存采用 revision 冲突检查和独立临时文件。保存当前镜头不会保存其他未保存机位；保存路径不会夹带机位预览。基础场景/角色结构被别处更改时明确要求刷新重建，避免数据显示新版本但模型仍旧。调试时可用 `PREVIS.savedData/revision/dirtyShots/discardCameraPreview` 检查状态。

对每个切点检查 `cut - 1/fps`、`cut`、`cut + 1/fps`；切点采用半开区间 `[start, end)`，避免两镜同时启用。结束帧取 `duration - 1/fps`。

可用项目暴露的 `window.PREVIS` 做验证：`ready`、`seek(t)`、`inspect()`、`setCameraOffset(shotId, offset)`、`saveCameraOffset(shotId, offset)`、`resetCameraOffset(shotId)`、`setView(mode)`。导出只读 `scene.json`，临时的 `setCameraOffset` 不会写盘；保存必须调用保存 API 或审片页的保存按钮。

## 官方来源

- 源码：https://github.com/heygen-com/hyperframes
- 官方运行时指南：https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/runtimes.md
- 官方三维确定性说明：https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/types/3d.md
- Three.js：https://threejs.org/docs/

本文件只保存此流程需要的操作结论。遇到接口差异时查项目安装版本的 `hyperframes/dist/skills/hyperframes/references/` 和 CLI `--help`，不要安装或更新无关的全局技能或账户配置。
