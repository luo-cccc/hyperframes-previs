# 运行、导出与媒体身份

当前验证基线为 Node.js 22.22.2、HyperFrames 0.9.10、Three.js 0.187.0，依赖版本以模板 package-lock.json 为准。升级前核对实际安装版本与接口；本包的 60fps 指离线导出规格。

## 初始化与绝对时间

- index.html 根元素声明 data-composition-id、data-start=0、data-duration、data-width、data-height、data-fps。改输出规格后运行 npm run validate 同步入口元数据。
- 纯 Three.js 入口设置空 window.__timelines 和 data-no-timeline，画面由 hf-seek 的 event.detail.time 驱动同一 renderAt(t)。没有伪造 GSAP 时间线。
- window.__hf.buildReady.previs 在场景、资源和首帧完成后 resolve。异步逐帧工作在监听函数内同步登记 event.detail.waitUntil(promise)。
- WebGL 使用 preserveDrawingBuffer；纹理和外部模型加载纳入 readiness。lib/ 提供本地 Three.js、OrbitControls 和许可证，预览不依赖 CDN。
- studio.html 嵌入干净入口。播放计时器只请求相同的绝对时间采样；自由观察和未保存预览不改变正式机位。

固定骨长和目标／实际手腕的区别见[场景契约](scene-contract.md)。资源、伤损、真假及光色均按 t 恢复，前后跳转和独立状态捕获不能留下未来状态。

## 命令职责

在制作单元目录执行：

| 命令 | 产物／范围 |
|---|---|
| npm ci；npm run prepare-libs | 安装锁定依赖，复制本地浏览器库 |
| npm run validate | 数据、来源、绑定和入口规格 |
| npm run studio | 启动本地编辑审片服务 |
| npm run lint | 锁定版本 HyperFrames 静态检查 |
| npm run spatial-check | review/spatial-report.json，声明范围内的采样代理告警 |
| npm run fight-check | review/fight-report.json，已实现战斗对象、真实接触间隙及可达性 |
| npm run snapshot | 用运行时渲染首尾、切点邻近及镜中图；不是从 MP4 提取的证据 |
| npm run state-capture -- --plan source-keyframes.json | 原镜与原时刻的独立状态 PNG 及完整性报告 |
| npm run render | 当前保存输入的 renders/previs.mp4、成功回执和独立尝试记录 |
| npm run boundary-pack -- --plan boundary-plan.json | 当前 MP4 的真实接点帧与短窗口；计划非空且端点已渲染才提取 |
| npm run feedback；npm run handoff | 实际批注包、分项检查、来源副本与返修请求 |

首次缺浏览器时运行 npx hyperframes browser ensure。宿主 GPU 不可用时可尝试 npm run render -- --no-browser-gpu，再核对实际画面。导出默认单 worker，减少 WebGL 上下文争用；重新导出需锁定 npm 依赖，不能只保留 lib/ 就声称具备导出环境。

## 视频发布与过期

正式导出使用 npm run render 包装器。它在独立暂存文件中生成视频，复核源未变化，并在 ffprobe 可用时检查尺寸、fps、时长与帧数，然后发布视频及 renders/render-receipt.json。失败保留上次成功视频；renders/render-attempt.json 单独记录本次尝试。缺 ffprobe 时 media_metrics_status=NOT_RUN。

渲染身份为 PREVIS_RENDER_CONTENT_V2：scene_sha256 是规范化渲染内容，scene_file_sha256 保留原文件取证。四项审阅关联是 scene_sha256、intake_sha256、render_inputs_sha256、video_sha256。

指纹追踪入口、规范化 scene.json、包锁和 src／lib／assets／models／textures／fonts／media／audio／shaders，以及资产 appearanceReference。额外本地依赖写入 scene.renderDependencies；远程素材先本地化。editLocks、editorHistory、deliveryGoal、reviewRouting、transitionMap 不绘像素，单独修改它们不会使相同媒体无故过期。

模型、轨道、脚本、素材或相关来源变化会使旧媒体待重导。直接调用底层 CLI 不会获得本包装器的来源关联回执；不能手改哈希把它提升为当前成功渲染。

## 跳转、切点和截图

普通 seek 使用 [start,end)，切点检查 cut-1/fps、cut、cut+1/fps，实际 MP4 末帧为 duration-1/fps。原状态捕获使用显式原 shot_id 的闭区间，可位于镜尾或非整帧时刻；它的 provenance=BOUNDARY_STATE_CAPTURE、is_encoded_video_frame=false。

window.PREVIS 提供 ready、seek、inspect、setView、机位预览／保存、captureStateAt 等接口。captureStateAt 拒绝未保存机位，临时采用指定原机位绘图，并恢复时间、视图、选择和光色。前后跳转与捕获恢复的图像一致性属于运行时验证，不等于人物表演或声音验收。

state-capture 不覆盖已存在的包目录；重复导出使用新的 --out，或核对并复用仍有效的原报告。

实际视频接点见[接点与时钟](boundary-previs.md)，交付状态和人工证据见[分项回执](scoped-receipts.md)。

## 接口参考

优先查项目安装包内的 hyperframes/dist/skills/hyperframes/references/ 和对应 CLI --help。外部入口：[HyperFrames 源码](https://github.com/heygen-com/hyperframes)、[运行时指南](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/runtimes.md)、[三维确定性说明](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/types/3d.md)、[Three.js 文档](https://threejs.org/docs/)。这些链接不表示本次已验证其主分支的新接口。
