# script-to-storyboard-prompts → HyperFrames

## 责任与兼容范围

上游负责分析、制作条件确认、人物/场景/道具文字资产、集场规划、场分析、预算分段、完整母稿，以及正式版本和剧情覆盖。本适配器接收已有效交付的目标段，制作三维媒体参考；它是可选下级能力，不新增上游第八步或强制前驱。

对照仓库 `luo-cccc/script-to-storyboard-prompts` 的提交 `0f3c747ee373f33f599408e00952a5bbc940e4da`、技能 0.3.0、状态 1.9/V4，以及本地已有的 0.2.0、状态 1.8/V3。只读取实际版本，不为了预演升级或重建权威状态。

上游镜头事实位于完整母稿的“景别、机位”“运镜及拍摄主体”“构图”“画面内容”“声效”；时间码相对当前正式段 0 秒。预算、台词话轮和状态分别核对，不把资产图提示词、预算计划或合成机械夹具当作真实完成的母稿。

## 接收的最小上下文

| 上游产物 | 接收内容 | 三维落实 |
|---|---|---|
| 项目状态与决定 | project_id、有效 state_ref、三项已确认设置与 decision_ref | 继承画幅、风格和段长上限，定位唯一段和版本 |
| 原剧本与场分析 | 同版原文、事件因果、关键空间、观看信息 | 空间布局、初始姿态、揭示边界；语义人工核对 |
| 人物档案与资产 | 角色 ID、height_cm、LOOK/STATE 版本、母图/四视图提示词和真实素材状态 | 米制高度、稳定占位 ID、造型与图像绑定；无图可先做空间占位 |
| 场景/道具资产 | 结构、地标、光源、道具 ID、归属与左右手 | 几何、照明、物件动画与遮挡 |
| 有效完整母稿 | formal_id、prompt_version、全文、实际交付位置 | 镜头、动作、台词与声音时间映射 |
| 同版预算 | budget_version、duration_s、镜头起止与阶段 | 保留镜数、段内时码和总长，不重新估时 |
| 首尾与持续状态 | start_state/end_state、人物/环境/道具/观看状态 | 前后承接、事件续接、未完成动作，不提前揭示 |

有效状态或正文缺失时只列实际缺项，不按技能目录、文件修改时间或“最新一段”猜项目。存在范围明确的其他事项阻断时，只阻断它实际影响的目标；受返修影响的本段版本不能当作有效输入。

## 只读提取与人工整理

对本地 JSON 状态及预算运行：

```text
python -X utf8 scripts/intake_storyboard.py --state /actual/project/run-state.json --budget /actual/project/budget.json --formal-id FORMAL_1 --out /actual/project/previs/FORMAL_1/P1/upstream-intake.json
```

工具接受版本 1.8/V3 或 1.9/V4 的明确 JSON 快照，检查其本次适配所需字段；不代替上游全部状态检查。它读取 `prompt_versions`、同版 DONE 覆盖与 TEXT 证据，解析实际母稿位置并保存全文/片段、版本、预算、原始资产与首尾状态，同时记录源文件 SHA-256。

`run-state.txt`、会话产物和非标准旧记录由代理实际阅读后整理成相同 `upstream-intake.json`，`input_mode=MANUAL_TRANSCRIPTION`，保留可定位原始交付与文件哈希；不能让程序猜测自由文本，也不能把手工规范化快照当成新的权威状态。会话无本地文件时，将用户实际提供的正文逐字保存为输入证据，记录会话定位；仍缺少必要证据时不伪造 PASS。

提取结果的 `semantic_review=NOT_RUN` 表示程序不验证剧情语义、原台词完整性或用户决定真实性。语义与媒体检查按实际范围记录，完成渲染与实际审片后，可用 `PREVIS_REVIEW_V1` 格式记录证据；四项关联哈希见 [handoff.md](handoff.md)。不能把静态结构通过当成审片完成。

## intake 契约与三维项目

由工具封存，避免手写哈希。核心字段为 `schema_version`、`adapter_version`、`input_mode`、项目/段/母稿/预算版本、完整 `production_settings` 与 `budget`、`master.ref/text/text_sha256`、`sources`、`upstream_snapshot`、`semantic_review=NOT_RUN` 和 `upstream_writes=false`。JSON 提取另外记录 `validation_profile=SCOPED_STATE_V2` 及 `state_scope`。

`sources` 必须实际提供 `state`、`budget`、`master`、`source_script`、`text_evidence` 五种职责的本地来源与初次哈希。共享预算按三版本选择器核对；母稿、证据和原文可使用明确 Markdown fragment，只核对该片段。没有明确 fragment 的文件仍保守核对全文，不猜正文范围。状态只重核当前目标的有效性、确认设置、源版本、首尾与相关资产，忽略单纯 `state_seq/next_required` 或其他段的推进。

角色/场景/道具提示词及实际资产若存放于其他文件，需作为本段明确来源或渲染依赖交接；不要只交状态内的路径字符串后声称已经读取或绑定。JSON 提取可重复添加 `--source asset_prompt=assets.md`、`--source scene_analysis=analysis.md` 或 `--source supporting_material=具体文件`，路径相对上游状态目录，此类额外来源核对专用文件全文。只提供本段实际依赖；共享长材料可先逐字保存所用片段和原定位，不扩大到无关项目。上游快照保留原始档案记录，机位/动作的执行补足保存在本适配项目。

### 文字／会话输入

把用户已实际提供的状态、预算、母稿、原文和检查证据逐字存入项目 `evidence/`，记录原会话定位；同一真实交付可以承担多个职责，但不能把一个凭空创建的空文件充当证据。代理实际阅读后写 `manual-draft.json`：项目/正式段/母稿/预算版本、三项确认记录、完整预算、`upstream_snapshot` 的角色与资产档案和当前 `coverage`、五种 `sources[].role/path/original_ref`。`coverage` 需包含真实有效的 `status=DONE`、三版本与首尾状态，不能把未完成草稿提升为 DONE。

```text
python -X utf8 <skill-dir>/scripts/finalize_manual_intake.py --draft <项目>/manual-draft.json --out <项目>/upstream-intake.json
```

工具读取实际文件，计算哈希、复制母稿和标明 `input_mode=MANUAL_TRANSCRIPTION`，不解析自由文本来猜状态，不创建或写回权威状态。文字镜序/时长不符合模板或证据不足时明确失败，人工核对缺项后再整理。封存后保留源证据不可变；重新交付使用新修订。

代理将母稿落实为 `scene.json` 和必要的 Three.js 场景代码，并写：

```json
{
  "upstream": {
    "intake": "./upstream-intake.json",
    "intake_sha256": "由bind-upstream脚本记录的实际哈希",
    "project_id": "实际项目ID",
    "formal_id": "FORMAL_1",
    "prompt_version": "P1",
    "budget_version": "B1"
  },
  "assetBindings": [
    {"actorId":"上游角色ID","assetId":"上游角色ID","height_cm":178,"look_version":"LOOK-1","representation":"proxy","appearanceReference":null}
  ],
  "sourceAssetIds": {"scenes":["实际场景ID"],"props":[]},
  "adaptationMap": [
    {"source_shot_id":"S1","scene_shot_id":"S1","source_ref":"母稿实际定位","status":"MAPPED","notes":"机位与坐标的执行补足，保留原叙事"}
  ]
}
```

填写完场景、资产绑定和逐镜映射后运行 `npm run bind-upstream`；它先检查映射，再记录 intake 哈希和版本，失败时不覆盖场景。没有人物时 actors 与资产绑定均可为空，不补造人物。别名、模板内部 ID 与上游资产的映射必须明确。道具只在母稿或已确认资产中存在时创建；模板的武器、走廊、开门与固定三镜都不能自动继承。

`npm run validate` 适配检查会核对源哈希、版本、画幅、总时长、镜头 ID/边界、逐镜映射、角色绑定与身高。它不验证摄影、原台词和事件语义，因此不能用通过结果代替人工审片。

预算若不能落在整帧上，先选择可准确表达的 fps；仍不能时显式设计并记录技术尾料/保留区间映射，再调整对应导出实现。检查器在未实现该映射时拒绝静默舍入。不得修改上游预算来迎合渲染器。

## 输出与返回

每个正式段默认一个适配项目及视频；同场拼接按额外请求保存偏移表，源段的 0 秒时钟仍保留。输出至少含源项目、`upstream-intake.json`、`handoff/manifest.json`、`handoff/prompts.md`（原母稿逐字副本）、`handoff/reference-attachments.md`、映射与实际预演回执。

`previs-receipt.json` 记录：formal_id、base_prompt_version、budget_version、adapter_version、来源哈希、source_time_basis=SEGMENT、输出视频规格与实际帧数、已检查项目、未实现项、语义检查证据、发现偏差和 `upstream_revision_required`。实际渲染未完成时不预填成功；可先返回项目和具体阻断。

上游接收该回执时可按其现有媒体观察规则人工登记局部观察，`scope=PREVIS_CAMERA_BLOCKING`；最终成片 MEDIA 检查与生成任务保持其实际状态。写回状态需沿用上游提交机制和当前授权，不能让预演工具直接推进正式段。机位微调若改变正式母稿的摄影事实，也须交回对应返修；只修复预演实现错误时修本地适配项目即可。

相关正文版本、预算、源版本或资产改变时报告过期；无关状态推进、共享文档其他片段追加不自动失效。复用只覆盖实际未受影响资源，新版本重新提取和审片。旧 intake 缺少新范围证据时请重新提取，旧回执保留以便追溯；不要手改 profile 伪装已核对。
