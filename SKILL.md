---
name: hyperframes-previs
description: 接收 script-to-storyboard-prompts 的有效正式段，或 xianxia-fight-director 的战斗六件套及工作JSON，制作可编辑的Three.js三维预演与HyperFrames参考视频。保留各上游原ID、时钟与证据；用于已交付分镜或打斗的HTML/3D预演，不重做上游创作，不凭“继续”自动生成媒体。
---

# HyperFrames 分镜与战斗预演

适配版本 0.6.1。将上游已交付的镜头和执行窗口实现为可编辑、可审阅的三维预演；Three.js 负责绝对时间采样，HyperFrames 逐帧导出。

## 选择来源

| 当前任务 | 先读 | 保留的来源身份 |
|---|---|---|
| script-to-storyboard-prompts 正式分镜 | [分镜接入](references/upstream-adapter.md) | formal_id、prompt_version、budget_version、原镜与资产 |
| xianxia-fight-director 战斗预演 | [战斗接入](references/fight-adapter.md) | 原 unit／shot／beat／keyframe、全场时间与来源 revision |
| 本技能工程的局部编辑或返修 | [编辑与审片](references/editor-review.md) | 当前已绑定来源、锁、保存版本及受影响对象 |

沿用已确认的画幅、风格、时长、镜序、资产、空间关系、台词和揭示时刻。实际读取原文与证据；只有影响本次实现的缺项才集中询问。不要求上游补独立分镜设计表，不凭状态版本猜技能包版本，也不将战斗段伪装成 FORMAL／P/B／DONE。

本适配器只读上游，在下游工程写实现、媒体和回执。一个已授权预演请求内可连续完成读取、搭建、检查和导出；用户仅说“继续”时沿已确认的当前任务推进，不因此切换流程或新增媒体交付。

## 实现和检查

1. **映射来源。** 保留原 ID、预算和原文。运行时统一采用当前单元 0 秒；战斗只减一次全场段偏移，按当前 execution.cues 续接，不每镜重播完整跨镜 beat。不把一镜内的动作阶段拆成新镜。
2. **搭建与采样。** 米制、Y 向上，明确朝向与执行补足。所有姿态、物件、事件和机位由 t 决定，直接跳转与顺序播放一致。默认 60fps；预算或切点不落整帧时选择能精确表达原时码的帧率，不舍入预算。
3. **保持真实约束。** 手臂采用固定骨长双段代理 IK；保留请求目标、实际手腕与不可达间隙。需要改原事实或正式摄影意图时交回上游；本地实现错误则在下游修复。简化代理不证明完整关节限位、受力或最终模型表现。
4. **编辑和导出。** 先核对来源与已保存数据，再做空间／战斗检查和实际渲染。机位、路径、锁、撤销、PNG 批注按[编辑说明](references/editor-review.md)操作。导出使用 npm run render，保留真实回执；代码、模型、素材或相关来源变化后重新生成证据。
5. **按范围交付。** 原状态 PNG 与实际 MP4 抽帧分开，闭端点保留原前镜归属。返回原稿、可编辑工程、参考视频和分项检查；交付文件存在不代表目标 COMPLETED。声音、平台或最终模型未实际执行时保留其真实状态。

## 按需读取

| 工作内容 | 参考 |
|---|---|
| scene.json、相机、手部 IK、检查边界 | [场景契约](references/scene-contract.md) |
| HyperFrames 初始化、导出、指纹与状态截图 | [运行时](references/runtime.md) |
| 门动作、时间映射与跨工程视频接点 | [接点与时钟](references/boundary-previs.md) |
| 同镜运动模板和布景复用 | [镜头复用](references/camera-patterns.md) |
| 交付文件、模型参考职责 | [交付清单](references/handoff.md) |
| PREVIS_REVIEW_V2、目标门槛和返修归责 | [分项回执](references/scoped-receipts.md) |
| 外部来源与便携工程 | [便携包](references/portable-bundle.md) |
| 维护、测试、目录与清理 | [维护指南](references/maintenance.md) |
| 当前版本和历史验证范围 | [验证索引](evals/README.md) |
| 外部设计思路的采用边界 | [采用说明](references/adopted-designs.md) |

新工程入口为 scripts/create_project.mjs；值班室联合演示使用 scripts/create_dutyroom_example.mjs；战斗 JSON 示例使用 scripts/create_fight_example.mjs。演示必须显式选择，泛化战斗布局不能冒充已实现完整动作。当前模板与样例的具体能力、限制以实际代码和[README](README.md)为准。
