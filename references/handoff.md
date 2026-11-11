# 交付文件与参考职责

在已保存的制作单元内运行 `npm run handoff`。它复核当前来源、媒体身份、接点和检查证据，写入 `handoff/`；视频渲染、平台提交和源稿修订需另行执行。

## 输出清单

| 文件 | 内容 |
|---|---|
| manifest.json | 来源身份、规格、视频状态、映射、检查和交付目标 |
| checks.json、previs-receipt.json | 分项结果、来源及媒体哈希、目标状态和未实现项 |
| revision-requests.json | 带原单元／镜头定位及证据的返修请求 |
| shots.csv | 当前镜头 ID、起止、时长和 beat 字段 |
| reference-attachments.md | 通用或战斗来源、人物资产绑定及参考职责 |
| prompts.md | 仅通用分镜：封存原稿的正文副本 |
| adaptation-map.json、transition-map.json | 仅通用分镜：逐镜映射及本地转场备注；未提供源转场时 source 为 null |
| source-execution.md、fight-map.json | 仅战斗：执行来源文本、原动作窗口与时钟、新视觉层来源要求 |
| source-keyframes.json | 仅战斗：所选来源关键帧记录 |
| demo-notes.md | 无来源绑定的显式演示说明 |

`handoff/source-keyframes.json` 是来源帧记录；原状态捕获读取的是项目根目录的 `PREVIS_SOURCE_KEYFRAMES_V1` 计划，两者用途不同，见[状态图说明](boundary-previs.md)。

单元完整交接还需 scene.json、运行时、来源证据和引用关系。工程外依赖用[便携包](portable-bundle.md)携带；handoff 里的来源路径不等于已复制素材。

## 视频与完成状态

`verified-render-current-inputs` 表示当前视频及成功回执与已保存输入匹配；只有 MP4、回执缺失或哈希不符时为 `unverified-or-stale`，尚无视频时为 `not-rendered`。文件已交付和目标已完成分别记录；没有实际证据的声音、语义或最终模型检查不会自动通过。

人工批注通过 `npm run feedback` 独立导出，交付时携带整个 `feedback-packages/<identity>/`，包括 PNG 和完整性清单。批注状态不写进视频模型提示词。分项审阅及目标门槛见[分项回执](scoped-receipts.md)。

## 参考职责

人物、场景和道具素材承担身份、服装、材质及形状；代理预演承担已实现的机位、相对空间、时刻与剪辑意图。占位外观、辅助线、标签和 Studio 控件不作为成片身份依据。素材路径本身不会让当前代理渲染器自动呈现真实造型。

原镜首尾的方向、持物、伤损、门体和持续术法需逐项检查。静态状态图、MP4 邻近运动和声音不能互相替代；固定骨长也不证明完整关节限位、支撑或受力。派生切片／观看版应保留原单元、实际帧窗口与偏移，不能替代原视频及回执。
