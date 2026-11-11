# 本地预览、检查与导出

模板随附 `lib/` 中的 Three.js 浏览器模块与许可。预览、场景校验和代理空间检查使用 Node.js，不要求先安装渲染依赖；`npm run studio` 默认在本机 4173 端口启动，端口占用时设置 `PREVIS_PORT` 后重启。

HyperFrames 导出、静态检查和截图需要先在项目内运行 `npm ci`。包锁固定 HyperFrames 0.9.10、Three.js 0.187.0；`npm run prepare-libs` 用于按已安装的 Three.js 重新准备本地库。缺浏览器时运行 `npx hyperframes browser ensure`。视频规格探测需要 ffprobe，接点提取还需要 ffmpeg。

## 项目命令

以下命令均在生成的制作单元目录执行：

| 命令 | 实际作用 |
|---|---|
| `npm run bind-upstream` | 校验来源与映射，写入 intake 哈希和来源身份 |
| `npm run validate` | 校验 scene、来源及绑定，同步 index.html 输出元数据 |
| `npm run studio` | 启动本地编辑审片服务；Ctrl+C 停止 |
| `npm run lint` | 运行 HyperFrames 静态检查 |
| `npm run spatial-check` | 写入 review/spatial-report.json，检查声明的代理几何 |
| `npm run fight-check` | 写入 review/fight-report.json，抽查已实现战斗代理 |
| `npm run snapshot` | 从运行时截取首尾、切点邻近及镜中图，输出到 review/ |
| `npm run state-capture` | 按根目录 source-keyframes.json 捕获原时刻状态图 |
| `npm run render` | 导出 renders/previs.mp4、成功回执和本次尝试记录 |
| `npm run boundary-pack` | 从当前 MP4 提取内部切点；跨工程连接需显式计划 |
| `npm run feedback` | 导出批注数据与带 PNG 的反馈包 |
| `npm run handoff` | 复核并写入交付文件、分项检查和目标状态 |

snapshot 和 state-capture 直接渲染场景；boundary-pack 提取实际视频。三者的用途及时间边界见[接点与时钟](boundary-previs.md)。handoff 不会渲染视频或执行平台提交。

## 确定采样

`index.html` 的 `data-*` 属性声明输出规格；`src/previs.js` 在 `hf-seek` 时按绝对时间调用 `renderAt(t)`。场景、动作、资源与灯光都从当前 t 求值，任意跳转应得到相同状态。`window.__hf.buildReady.previs` 在首帧完成后 resolve；扩展异步素材加载时也应纳入就绪条件。

Studio 嵌入同一干净入口。自由观察、选框和路径线用于编辑；导出读取已保存数据。当前渲染器生成代理几何，不会因填写图片路径自动加载真实角色模型或贴图。

## 导出与媒体身份

`npm run render` 先校验、锁定输入，再用单 worker 输出临时视频；复核来源与渲染输入未变后，发布视频及 `renders/render-receipt.json`。失败保留上次成功视频，本次失败写入 `renders/render-attempt.json`。

可传 `--no-browser-gpu`、`--browser-gpu` 或 `--quality draft|looks|delivery|standard|high`。例如 `npm run render -- --no-browser-gpu`；更改运行方式后仍需核对实际画面。

ffprobe 可用时检查尺寸、fps、时长和帧数；缺失时 `media_metrics_status=NOT_RUN`，不能据此让规格检查通过。60fps 是模板的离线导出规格，不是实时播放性能承诺。

`PREVIS_RENDER_CONTENT_V2` 用四项哈希关联当前媒体：`scene_sha256`、`intake_sha256`、`render_inputs_sha256`、`video_sha256`。`scene_file_sha256` 另保留原文件取证；scene_sha256 排除锁、编辑历史、交付目标、返修路由及转场实现备注。

渲染指纹跟踪入口、场景、包锁、src/lib 及模型、纹理、媒体等资源目录。项目外本地依赖通过 `scene.renderDependencies` 或资产的 `appearanceReference` 显式声明；远程素材先本地化。实质机位、轨道、代码或素材变化后，应重导相关媒体并更新证据。只修改批注或目标状态不会改变相同画面的身份。

文件与验收规则见[交付清单](handoff.md)和[分项回执](scoped-receipts.md)。
