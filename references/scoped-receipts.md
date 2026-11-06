# 分项检查、目标状态与返修

npm run handoff输出checks.json、previs-receipt.json、revision-requests.json及manifest。分镜工程返回上游母稿逐字副本，战斗工程返回来源执行文本视图与原 ID 映射；独立 demo 只返回演示说明。文件列表见[交付清单](handoff.md)。

## 分开记录交付与完成

项目根目录可添加delivery-goal.json：

~~~json
{"id":"review-join-1","target":"BOUNDARY_REVIEW","required_checks":["audio"]}
~~~

目标保留以下必需项；required_checks 只能增加要求，空数组不能取消必需项。

| target | 默认必需检查 |
|---|---|
| PREVIS | source_structure、render_specs |
| BOUNDARY_REVIEW | 上述两项及 boundary_source、boundary_extraction、boundary_frame、boundary_motion |
| FIGHT_PREVIS | source_structure、render_specs、fight_proxy |
| FIGHT_REVIEW | 上述三项及 state_keyframes、attack_response、contact_phase、prop_ownership、persistent_effect、attrition_cost |
| MODEL_SUBMISSION | source_structure、capability、inputs、platform_submission |
| FINAL_MODEL | 上述四项及 final_model |

声音或真假揭示属于本次目标时，显式把 audio／knowledge_reveal 加入 required_checks。

目标状态为COMPLETED、IN_PROGRESS、BLOCKED；delivered_artifacts单独列文件。缺实际声音、平台模式未知或只有条件计划时，相关检查保持NOT_RUN/UNKNOWN/PENDING，目标如实未完成。仅有MP4不代表最终模型交付已完成。

审片页“接点证据与交付”可提取已渲染视频的接点、更新回执和查看分项状态。刷新状态会只读重核实际检查证据、接点依赖和目标条件，证据过期时撤销旧完成结论；不会在GET请求中改写已发布回执。按钮使用保存数据；机位草稿需先保存或撤销。跨工程计划放在本工程boundary-plan.json。CLI命令继续可用，页面不会代替实际导出或平台生成。

## 实际检查记录

自动项包括 source_structure、render_specs、spatial_proxy、boundary_source、boundary_extraction、fight_proxy 和 state_keyframes；其scope说明实际程序检查范围。代理空间无警告不代替像素可见性、接触或剧情检查。提取成功只使extraction通过，画面/动态/声音仍需实际观察。

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

## 战斗源与真实接触

fight_proxy 只表示声明代理范围的采样结果，state_keyframes 只表示原状态图的身份与完整覆盖。attack_response、contact_phase、prop_ownership、persistent_effect、attrition_cost、knowledge_reveal 必须有实际语义／画面观察证据，不能从原作者 review 或结构测试自动提升。

固定骨长检查使用实际手腕计算接触 gap。不可达目标或其他 fight-check 告警会让 fight_proxy 保持 FAIL，相关目标 BLOCKED；不通过手改审阅覆盖自动失败。来源 lineage 保留 provider／unit，不制造 formal／prompt／budget。详细输入、时钟和终点状态规则见[战斗接入](fight-adapter.md)。
