---
name: hyperframes-previs
description: 将通用分镜、导演稿或 xianxia-fight-director 战斗交付落实为可编辑的 Three.js 三维预演与 HyperFrames 参考视频。用于已有镜头或打斗的预演制作、局部编辑与审片。
---

# HyperFrames 分镜与战斗预演

适配版本 0.7.0。Three.js 按绝对时间采样，HyperFrames 逐帧导出；能力和启动方式见 [README](README.md)。

## 选择入口

| 任务 | 先读 |
|---|---|
| 通用分镜、导演稿或镜头文字 | [通用接入](references/upstream-adapter.md) |
| xianxia-fight-director 当前 JSON 1.3 或六件套 | [战斗接入](references/fight-adapter.md) |
| 已有工程的机位、路径、锁、撤销与批注 | [编辑与审片](references/editor-review.md) |

实际读取原稿和相关证据，沿用原单元、镜头、资产、时码、台词、空间关系与揭示窗口。自由文字由代理整理为明确映射；缺失尺寸等只作可追溯的本地执行假设。只读来源，旧契约需要重新整理后接入。

## 制作原则

1. 保留原镜序和预算，镜内阶段不增加切镜。运行时从单元 0 秒开始；战斗全场时码只减一次段偏移，动画使用当前 `execution.cues` 窗口。
2. 场景采用米制、Y 向上，姿态、物件、事件和机位由绝对时间求值。时长与切点不能为帧率静默舍入。
3. 当前模板使用代理几何与固定骨长手臂 IK，保留目标、实际手腕和不可达间隙。战斗生成器交付布局；新特效、变身、内景和转场的来源登记还需落实为动画。
4. 导出读取已保存数据。需要改变源事实或摄影意图时返回源稿修订请求；实现错误在本地修复。修改后重做受影响的媒体与证据。
5. 分别交付原稿、可编辑工程、实际媒体和分项检查。原状态 PNG、MP4 抽帧、代理检查及语义／声音观察按各自证据记录，目标完成状态依赖实际检查。

## 按需参考

| 工作内容 | 文档 |
|---|---|
| 场景、相机、动作、IK 与采样 | [场景契约](references/scene-contract.md) · [运镜模板](references/camera-patterns.md) |
| 初始化、预览、导出与媒体身份 | [运行指南](references/runtime.md) |
| 时间映射、状态图与真实视频接点 | [接点与时钟](references/boundary-previs.md) |
| 交付文件、目标、证据与返修 | [交付清单](references/handoff.md) · [分项回执](references/scoped-receipts.md) |
| 移动工程与外部依赖 | [便携包](references/portable-bundle.md) |
| 维护及已有验证 | [维护指南](references/maintenance.md) · [验证记录](evals/README.md) |
