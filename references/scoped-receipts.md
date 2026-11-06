# 分项检查、目标状态与返修

npm run handoff输出checks.json、previs-receipt.json、revision-requests.json及manifest。绑定工程继续返回上游母稿逐字副本；独立demo只返回demo说明，不生成假母稿。

## 分开记录交付与完成

项目根目录可添加delivery-goal.json：

~~~json
{"id":"review-join-1","target":"BOUNDARY_REVIEW","required_checks":["audio"]}
~~~

target为PREVIS、BOUNDARY_REVIEW、MODEL_SUBMISSION或FINAL_MODEL。PREVIS默认要求来源结构和实际视频规格；BOUNDARY_REVIEW另要求接点来源、提取、画面及运动。平台提交和最终模型目标分别保留能力、真实输入、实际提交和最终媒体的必要条件，不能用required_checks空数组取消。

目标状态为COMPLETED、IN_PROGRESS、BLOCKED；delivered_artifacts单独列文件。缺实际声音、平台模式未知或只有条件计划时，相关检查保持NOT_RUN/UNKNOWN/PENDING，目标如实未完成。仅有MP4不代表最终模型交付已完成。

审片页“接点证据与交付”可提取已渲染视频的接点、更新回执和查看分项状态。刷新状态会只读重核实际检查证据、接点依赖和目标条件，证据过期时撤销旧完成结论；不会在GET请求中改写已发布回执。按钮使用保存数据；机位草稿需先保存或撤销。跨工程计划放在本工程boundary-plan.json。CLI命令继续可用，页面不会代替实际导出或平台生成。

## 实际检查记录

自动项包括source_structure、render_specs、spatial_proxy、boundary_source和boundary_extraction；其scope说明实际程序检查范围。代理空间无警告不代替像素可见性、接触或剧情检查。提取成功只使extraction通过，画面/动态/声音仍需实际观察。

新增adapter-review.json采用PREVIS_REVIEW_V2：

~~~json
{
  "schema_version":"PREVIS_REVIEW_V2",
  "scene_sha256":"复制当前成功回执的值",
  "intake_sha256":null,
  "render_inputs_sha256":"复制当前成功回执的值",
  "video_sha256":"复制当前成功回执的值",
  "goal_id":"review-join-1",
  "checks":{
    "boundary_motion":{
      "status":"CHECKED",
      "scope":"已正常速度查看所选A出点前与B入点后的动作相位；声音未听取",
      "boundary_identity":"复制当前boundary-report.json的identity",
      "evidence":[{"path":"review/motion-observation.md","sha256":"该实际文件的SHA-256","kind":"AUDIT_RECORD"}]
    },
    "audio":{"status":"NOT_RUN","scope":"未提供实际音轨或试听","evidence":[]}
  },
  "findings":[],"unimplemented":["声音与口型未实现"]
}
~~~

示例中的说明须换成真实值；不能把复制哈希或创建空记录当成已观察。每项有status、具体scope和evidence；PASS/CHECKED需要项目内实际文件及预先记录的SHA-256。工具检查文件完整性与版本关系，不证明用户登记的判断属实。

可由实际review填写text_alignment、boundary_frame、boundary_motion、audio、capability、inputs、platform_submission、final_model。自动检查不能被手工覆盖。读稿检查可先于渲染；媒体项仍须匹配当前成功视频四哈希。接点画面与运动另绑定boundary_identity；一端素材、计划或邻近运动变化使该包及相关review失效。平台项须匹配当前goal_id；提交与最终模型还要求实际task_ref、PROVIDER_RECORD证据，最终媒体要求实际VIDEO/AUDIO证据。

旧PREVIS_REVIEW_V1按原语义和原四哈希继续复用，不升级成新的声音、接点或平台结论。相关转场变化只使边界检查待复核；其他有效TEXT检查保留。新证据被修改时对应检查STALE，不能假称当前验收。

## 返修归责

findings中的每条记录需要id、summary、route、affected和实际证据。route为：

- LOCAL_IMPLEMENTATION：母稿正确，本地几何、动作或机位实现错误。
- UPSTREAM_REVISION：需要改母稿事实、预算、边界或正式摄影意图。
- PLATFORM_INPUT：平台模式/素材绑定/真实输入缺口。
- REVIEW_REQUIRED：尚需核对证据或判断归责。

revision-requests.json保留来源版本、受影响单元和证据，仅是请求，不执行返修或写回。上游仍通过自己的授权提交机制处理next_required、覆盖和游标；本工具不推进它们。平台未知只阻断实际依赖该能力的目标，不统一阻断正确的本地空间预演。

审查与重新导出分开：修正提示词/代码不说明旧媒体已修好，需要新结果和新检查才能更新对应结论。目标、检查及返修元数据不绘像素，不应仅因写入这些记录让相同视频过期；实质轨迹、模型、素材和时钟仍追踪来源。

## 战斗源扩展

0.6.0添加FIGHT_PREVIS/FIGHT_REVIEW目标及fight_proxy、state_keyframes、attack_response、contact_phase、prop_ownership、persistent_effect、attrition_cost、knowledge_reveal检查。前两项是明确范围的自动采样/状态捕获，后续语义项需绑定实际观察，不能手工覆盖自动项。来源lineage保留provider/unit，不制造formal/prompt/budget。详细输入、时钟和终点状态规则见 [fight-adapter.md](fight-adapter.md)。
