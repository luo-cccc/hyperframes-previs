# 分项检查、交付目标与返修

`npm run handoff` 分别写出文件清单、检查结果和目标状态，具体文件见[交付清单](handoff.md)。本页说明如何登记实际审阅以及判断目标完成。

## 交付目标

在项目根目录提供 `delivery-goal.json`，例如：

~~~json
{"id":"review-join-1","target":"BOUNDARY_REVIEW","required_checks":["audio"]}
~~~

未指定时，通用工程使用 PREVIS，战斗工程使用 FIGHT_PREVIS。required_checks 只能增加要求：

| target | 默认必需检查 |
|---|---|
| PREVIS | source_structure、render_specs |
| BOUNDARY_REVIEW | PREVIS 各项，及 boundary_source、boundary_extraction、boundary_frame、boundary_motion |
| FIGHT_PREVIS | source_structure、render_specs、fight_proxy |
| FIGHT_REVIEW | FIGHT_PREVIS 各项，及 state_keyframes、attack_response、contact_phase、prop_ownership、persistent_effect、attrition_cost |
| MODEL_SUBMISSION | source_structure、capability、inputs、platform_submission |
| FINAL_MODEL | MODEL_SUBMISSION 各项，及 final_model |

声音或真假揭示属于任务时，追加 audio／knowledge_reveal。必需项均为 PASS/CHECKED 时目标为 COMPLETED；FAIL、STALE、UNKNOWN、PENDING 或 NOT_IMPLEMENTED 等缺口使目标 BLOCKED；其余尚未执行项通常为 IN_PROGRESS。delivered_artifacts 单独记录实际文件，不因生成 MP4 就完成最终模型目标。

## 自动检查与人工审阅

自动项为 source_structure、render_specs、spatial_proxy、boundary_source、boundary_extraction、fight_proxy、state_keyframes，其 scope 限定实际检查范围。代理采样与文件完整性不代替画面、动作或剧情判断。

人工记录保存为 `adapter-review.json`，格式为 PREVIS_REVIEW_V2。例如实际观察了接点运动后：

~~~json
{
  "schema_version":"PREVIS_REVIEW_V2",
  "scene_sha256":"当前回执的实际值",
  "intake_sha256":null,
  "render_inputs_sha256":"当前回执的实际值",
  "video_sha256":"当前回执的实际值",
  "goal_id":"review-join-1",
  "checks":{
    "boundary_motion":{
      "status":"CHECKED",
      "scope":"按正常速度查看所选出点前与入点后的动作相位；未检查声音",
      "boundary_identity":"当前接点包的实际 identity",
      "evidence":[{"path":"review/motion-observation.md","sha256":"该实际文件的SHA-256","kind":"AUDIT_RECORD"}]
    },
    "audio":{"status":"NOT_RUN","scope":"尚未试听","evidence":[]}
  },
  "findings":[],"unimplemented":["声音与口型未实现"]
}
~~~

示例值需替换为实际记录；intake_sha256 仅无来源演示为 null。PASS/CHECKED 必须有项目内实际文件及预先记录的 SHA-256。工具验证文件完整性和身份关系，不证明记录者的判断属实，也不能用手工审阅覆盖自动失败。

可人工登记 text_alignment、boundary_frame、boundary_motion、audio、capability、inputs、platform_submission、final_model，以及战斗的 attack_response、contact_phase、prop_ownership、persistent_effect、attrition_cost、knowledge_reveal。

text_alignment、capability、inputs 可以先于视频，但仍须匹配当前 scene、intake 与渲染输入。其余媒体审阅须绑定当前成功视频的四项哈希；接点画面／运动另绑定当前 boundary_identity。平台检查须对应当前 goal_id；提交和最终模型结论还需 task_ref、PROVIDER_RECORD 证据，最终模型另需实际 VIDEO/AUDIO 文件。

来源、媒体、计划或证据改变后，相应记录变为 STALE；修正代码或提示词不表示旧媒体已经修好。原状态图与视频证据的差别见[接点说明](boundary-previs.md)。

## 战斗检查

fight_proxy 仅表示声明代理的采样结果；不可达手部目标及其他 fight-check 告警使其 FAIL。生成器的 PARTIAL_LAYOUT_ONLY 实现标为 NOT_IMPLEMENTED，不能以空动作通过战斗目标。state_keyframes 只核对来源身份与原状态图完整覆盖。

attack_response、contact_phase、prop_ownership、persistent_effect、attrition_cost、knowledge_reveal 需实际语义或画面观察，不能从作者原 review 自动提升。来源要求和本地实现范围见[战斗接入](fight-adapter.md)。

## 返修请求

每条 finding 带 id、summary、route、affected 和实际证据。route 为：

- LOCAL_IMPLEMENTATION：源稿成立，本地几何、动作或机位实现有误。
- UPSTREAM_REVISION：需要改源稿事实、预算、边界或摄影意图。
- PLATFORM_INPUT：平台模式、能力或真实输入缺口。
- REVIEW_REQUIRED：尚需核对证据或判断归责。

revision-requests.json 保留原来源身份、受影响单元与证据，仅提出请求，不修改源稿或外部制作状态。实质输入修改后重新导出受影响媒体并记录新检查；单独修改目标、锁或返修备注不改变相同画面身份。
