# 交付文件与下游参考职责

在已保存工程中运行 npm run handoff。工具复核当前来源、媒体身份、所选接点和实际检查证据，再分别记录交付文件与目标状态；它不渲染新视频、不执行平台提交，也不推进上游覆盖。

## 按来源返回

| 文件 | 正式分镜 | 战斗 | 显式演示 |
|---|---|---|---|
| manifest.json、checks.json、previs-receipt.json | 来源、媒体状态、检查和目标 | 同左，保留 provider／unit | 演示身份和实际范围 |
| revision-requests.json | 原正式段／版本定位的返修 | 原 unit／shot／beat／keyframe 定位的返修 | 本地演示问题 |
| prompts.md | 所选上游母稿逐字副本 | 不生成假母稿 | 不生成 |
| source-execution.md | 不适用 | intake 执行文本视图，保留来源及转录说明 | 不适用 |
| adaptation-map.json、transition-map.json | 本地映射与原转场上下文 | 由 fight-map.json 表达 | 不适用 |
| fight-map.json、source-keyframes.json | 不适用 | 原窗口、时钟与关键状态要求 | 不适用 |
| reference-attachments.md | 实际资产、参考职责和限制 | 同左 | 不套用源提示词 |
| demo-notes.md | 不适用 | 不适用 | 明确没有真实上游身份 |

完整可编辑项目还包括 scene.json、运行时、来源证据及原目录关系。工程外来源用[便携包](portable-bundle.md)一起交接，不能只压缩单元子目录。

renders/render-receipt.json 必须对应当前保存输入和视频；只存在 MP4、缺成功回执或哈希不匹配时 videoStatus 为 unverified-or-stale。旧审片和失败尝试保留历史，不能据其声称当前视频已修好。

## 批注和人工审阅

npm run feedback 独立导出 handoff/feedback.md、feedback.json 和带 PNG 的 feedback-packages/<identity>/。交付整个包；批注状态和来源证据不塞进视频模型提示词。OPEN、RESOLVED、VERIFIED 分别表示待处理、已处理、附证据验收，过期图不能作为当前验收。

新增 adapter-review.json 使用 PREVIS_REVIEW_V2，记录每个检查的 status、实际 scope、项目内证据及 SHA-256。媒体检查绑定当前四项身份，接点检查另绑定 boundary_identity；实际提交与最终媒体还要保留真实平台记录。旧 V1 只按原范围兼容，不用于新的分项结论。结构与例子见[分项回执](scoped-receipts.md)。

## 参考承担什么

- 人物、场景、道具图承担真实身份、服装、材质和形状，绑定用户实际素材。
- 预演承担已实现的机位、相对空间、动作时刻和剪辑意图；固定骨长也不证明完整关节限位、支撑或受力。
- 下游可自然化步态、布料与细节；占位人物外观、关节形状、辅助线、标签和 Studio 控件不作为成片身份依据。
- 原镜首尾的方向、持物、伤损、门体和持续术法需要逐项检查。状态图、MP4 邻近运动和声音分别记录，不能互相替代。

参考视频不能保证生成模型逐像素或逐镜保留。是否支持视频参考、实际时长／张数／尺寸限制由目标平台的当前能力决定；本工具没有执行的平台或最终模型工作保留 NOT_RUN／UNKNOWN。

如需切片或拼接观看版，记录原单元、实际帧窗口及成片偏移，并保留原视频和回执。新切片／观看版是派生参考，不因产生文件而成为新的上游正式段。
