# 通用分镜与导演稿接入

将已有分镜或导演稿整理为单元映射，绑定到可编辑三维预演。普通输入不依赖特定创作工具或项目状态机；仙侠战斗六件套与工作 JSON 走[战斗接入](fight-adapter.md)。

## 准备输入

已结构化的单元使用 `PREVIS_STORYBOARD_SOURCE_V1`；自由文字、Markdown 或会话内容由代理实际读稿后整理为同字段的 `PREVIS_STORYBOARD_DRAFT_V1`。会话原文先保存为本地证据。工具不自动解析剧本或推断镜序、时长。

最小输入：

~~~json
{
  "schema_version": "PREVIS_STORYBOARD_SOURCE_V1",
  "id": "scene-entrance",
  "duration_s": 8,
  "time_basis": "SEGMENT",
  "shots": [
    {"id": "wide-entrance", "start_s": 0, "end_s": 5},
    {"id": "hand-detail", "start_s": 5, "end_s": 8}
  ],
  "master": {"path": "director.md"}
}
~~~

`master.path` 相对输入 JSON，指向实际原稿，可用明确的 Markdown 标题或 anchor 选择片段，如 `director.md#门口一场`。镜头 ID 唯一，时间从当前单元 0 秒起连续覆盖 `duration_s`。镜头内可保留原动作、摄影、声音和状态等字段。

按实际来源提供可选的 `project_id`、`version`、`production_settings`、`asset_catalog`、`start_state`、`end_state`、`assumptions`：

- `production_settings` 可给数值画幅 `video_aspect_ratio` 和文字风格 `visual_style`。
- `asset_catalog` 按 `actors`、`scenes`、`props` 分类，各项保留原 `id`；明确给出的身高、造型或状态版本会参与绑定检查。
- 原文未编号时可建立注明来源定位的本地映射 ID。新提议的时长、切点或代理尺寸列为执行假设，不写成源事实。

## 创建、封存与绑定

从仓库根目录执行：

~~~text
node scripts/create_project.mjs work/my-previs
python -B -X utf8 scripts/intake_storyboard.py --project <通用源.json> --out work/my-previs/upstream-intake.json
~~~

人工转录将 `--project` 换成 `--draft`。需要封存额外素材说明或参考文字时，可重复传 `--source asset_prompt=assets.md#角色` 等明确的 `role=本地路径`，路径相对输入 JSON。输出必须是新文件；工具只读来源。

封存包为 `PREVIS_STORYBOARD_ADAPTER_V1`，provider 为 `storyboard`。它记录原单元、镜头预算、源版本、原稿、资产、状态、假设和来源哈希。正文视图去除 UTF-8 BOM 并统一为 LF；原文件字节不改写。

按原稿替换模板中的 `scene.json`，完成以下映射，再进入工程目录运行 `npm run bind-upstream`、`npm run validate`：

| 场景内容 | 绑定要求 |
|---|---|
| `shots` | 原镜头 ID、顺序与起止时间一致；不把镜内动作阶段拆成新镜 |
| `adaptationMap` | 每镜一项，含 `source_shot_id`、同名 `scene_shot_id`、实际 `source_ref` 和 `status=MAPPED` |
| `assetBindings` | 每个本地角色对应一个源 `assetId`；无人物时为 `[]` |
| 代理尺寸 | 源身高存在时保持一致；未给时用 `dimensions_basis=LOCAL_EXECUTION_ASSUMPTION`，不填写虚构源身高 |
| `sourceAssetIds` | 若填写，使用 `actors`、`scenes`、`props` 中实际存在的资产 ID |

绑定工具写入 `scene.upstream` 的 intake 路径、哈希、provider 和 lineage。画幅和已给资产版本会检查；风格、台词、摄影意图及人物表演仍需实际审阅。场景和轨道写法见[场景契约](scene-contract.md)。

## 来源变更与交付

通用映射 JSON 按整文件复核；原稿和额外来源按明确片段或整文件复核。所选内容变化后重新封存并绑定；片段外变化仅记录诊断。图像和模型还需通过资产绑定或渲染依赖实际交接。

时长和切点须准确落在输出帧网格，选择可表达原时码的 fps，不舍入预算。素材或全片偏移有明确依据时才填写 `timeMapping`，见[接点与时钟](boundary-previs.md)。

实现、导出后运行 `npm run handoff`，返回封存正文副本 `handoff/prompts.md`、逐镜映射、来源身份及实际检查状态。程序校验不等于语义或媒体验收。运行步骤见[运行时](runtime.md)，文件与返修职责见[交付清单](handoff.md)和[分项回执](scoped-receipts.md)；工程外来源随[便携包](portable-bundle.md)交接。
