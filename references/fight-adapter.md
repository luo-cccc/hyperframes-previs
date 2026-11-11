# 仙侠战斗接入

接收 `xianxia-fight-director` 当前工作 JSON **1.3**，或实际读稿后整理的战斗六件套。保留原制作段、镜头、动作拍和关键帧 ID；普通分镜见[通用分镜接入](upstream-adapter.md)。

## 从工作 JSON 创建工程

从仓库根目录执行：

~~~text
node scripts/create_fight_example.mjs work/my-fight --project <战斗project.json>
~~~

目标目录必须不存在，原制作段 ID 须能安全用作目录名。生成器逐字复制源文件至输出 `sources/project.json`，为每个原制作段建立工程，并完成接收、绑定和结构校验。也可使用 `--source-dir <examples目录> --example <案例名>` 选择已有源文件；`--upstream-skill-dir <包目录>` 只记录实际包元数据，未给时保持 UNKNOWN。

生成结果统一为 **PARTIAL_LAYOUT_ONLY**：源镜头、执行窗口与关键帧要求已映射，人物和机位只是可编辑布局，战斗动作、接触、伤损、特效及声音仍需实现。`fight-implementation.json` 记录尺寸、坐标和机位假设及未实现项；`source-mapping.json` 保留原执行字段与新视觉层要求。内部数值蓝图不自动套入源稿。

默认 60fps，可用 `--fps` 指定 1–240 范围内能精确表达全部段长和切点的帧率。自动尺寸采用源数值画幅、1280 像素长边和偶数像素；无法精确表示的画幅会拒绝，需要手工搭建对应工程，不能近似改写源画幅。

## 单段接收与六件套转录

已有自行搭建的工程时，单独封存一个原制作段：

~~~text
python -B -X utf8 scripts/intake_fight.py --project <战斗project.json> --segment <原segment_id> --out <工程/upstream-intake.json>
~~~

再按[场景契约](scene-contract.md)实现原镜头和资产，在工程内运行 `npm run bind-upstream`、`npm run validate`。输出文件不可覆盖；新修订使用新路径。

文字六件套先整理为 `PREVIS_FIGHT_DRAFT_V1`，根字段为 `schema_version`、`project`、`segment_id`、`mapping`、`assumptions`。`project` 必须是显式转录的完整 1.3 结构；`mapping` 的每项含可解析的 `/project/...` JSON Pointer、六件套 `role` 和原文 `locator`，六种 role 都要有定位。

~~~text
python -B -X utf8 scripts/intake_fight.py --draft <人工整理稿.json> --out <工程/upstream-intake.json> --evidence design=01-design.md --evidence assets=02-assets.md --evidence storyboard=03-storyboard.md --evidence keyframes=04-keyframes.md --evidence execution=05-video-prompts.md --evidence review=06-review.md
~~~

证据路径相对整理稿。同一真实文件可承担多个 role，空文件不接受。可用 `--evidence storyboard=03-storyboard.md#章节` 明确选择片段。转录模式只检查整理结构，不声称原作者交付过 JSON，也不提升原稿完成状态。

## 来源与依赖

当前封存契约是 `PREVIS_FIGHT_ADAPTER_V1`、adapter 0.7.0、`FIGHT_SELECTED_SCOPE_V2`，只接受当前版本。`unit` 保留全场起止，lineage 记录源字节与所选范围修订；工具只读源文件，不修改剧情或外部制作状态。

选择范围包含本段镜头、当前执行 cue、完整 beat 及递归前驱、资源、痕迹、真假、相关资产与关键帧。1.3 的可选登记按实际给出的内容复核：

| 登记 | 关键约束 |
|---|---|
| `tracks` | 恰一条世界线和至少一条内景线；beat/shot 归属一致，按线连续，内景镜头含 `outer_state`，返回世界线接上该状态 |
| `vfx` | 保留归属、层级、尺度、生命周期与制作路线；呈现层不能接触世界或留残留，世界内效果须有残留或消退 |
| `forms` | 两套资产共享原文身份锚点；关联转折拍与本人代价，阶梯至少三级，连续形变镜头为 high |
| `transitions` | 相邻镜头、每切点一项，保留原层级、载体和切点条件；桥接两侧为 high，其余切点不制造转场 ID |

依赖闭包还纳入相关前驱、后续转场端点镜头及关键帧、资源和资产。它们是复核资料，不能把未来人物或状态提前放进当前画面。相关内容改变时旧适配被拒绝；未纳入的其他段变化、作者审阅注记变化仅作诊断。转录证据默认按整文件复核，明确选择片段后只以选中片段决定失效。

`master.fragments` 是本段执行字段及相关视觉层文字的来源视图；完整导演 beat 仍留作因果参考。形态 `duration`、`exit` 保留在选择中，不作为可复制执行文本。源资料接收通过不代表这些效果已动画化。

## 时钟与原状态

源数值统一为全场成片秒；运行时为段内秒，只减一次 `unit.battle_start_s`。实际动画采用当前 `shot.execution.cues`，不能每镜重播完整跨镜 beat。世界经过时间不能从成片时长推定，慢镜也不授权自动修改素材播放速率。

原关键帧属于原镜头的闭区间，段界 handoff 归前段末镜。生成的 `source-keyframes.json` 保留原时刻和镜号；`npm run state-capture -- --plan source-keyframes.json` 渲染独立 PNG，可保留镜尾和非整帧时刻。MP4 使用半开区间，末帧为 `duration-1/fps`；状态 PNG 不冒充编码视频帧。实际视频接点见[接点与时钟](boundary-previs.md)。

## 实现战斗代理

`environment.type=battlefield` 使用显式 bounds、ground、worldZero；人物代理支持 humanoid、creature、manifestation。源资产与本地角色通过 `assetBindings` 对应，身高和造型缺项作为本地执行假设。

`combat.schema_version=PREVIS_COMBAT_V1` 的实现接口：

| 字段 | 用途与约束 |
|---|---|
| `objects` | 稳定 id 和绝对时间 keys；position/rotation/scale 插值，visible/owner_id/hand/state 阶梯求值；器物转手与回收保持同一对象 |
| 附件与效果 | `attachment=hand` 随指定持物手；`attachment_role=surface` 仅用于随手伤损 mark，不占第二件持物；`solid:false` 表示非实体效果，`light` 提供有限范围光源 |
| `contacts` | 声明角色手脚或物件对目标的接点、时窗与预期；计划接触和意外穿模分别记录 |
| `events` | 资源、伤损、地形、真假、可见性及光色按绝对时刻恢复；跳转或跨段不能复原已发生的后果 |

固定骨长 IK 保留请求目标、实际手腕与真实间隙，不可达时报告 ARM_TARGET_UNREACHABLE。接口与检查限制见[场景契约](scene-contract.md)；采样可达不证明完整关节限位、支撑或受力。

## 检查与交付

完成本地实现后，在各单元工程执行 `npm run validate`、`npm run spatial-check`、`npm run fight-check`，再按[运行时](runtime.md)渲染和捕获状态。所有相邻单元已渲染且计划有连接时，运行 `npm run boundary-pack -- --plan boundary-plan.json`；生成计划已关联实际登记的转场 ID，检查器逐 ID 复核原端点及帧修订。

`npm run handoff` 返回执行来源视图、fight-map、关键帧要求、检查和返修请求。PARTIAL_LAYOUT_ONLY 使 fight_proxy 保持 NOT_IMPLEMENTED；代理告警使其 FAIL，相关交付目标为 BLOCKED。不能用作者 review 或手工审阅覆盖自动失败。

FIGHT_PREVIS 和 FIGHT_REVIEW 的必需项、语义证据及返修归责见[分项回执](scoped-receipts.md)。文件清单见[交付清单](handoff.md)，工程外来源随[便携包](portable-bundle.md)交接。
