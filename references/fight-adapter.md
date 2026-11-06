# 仙侠打斗导演预演接入

0.6.0新增xianxia-fight-director第二上游；原script-to-storyboard-prompts正式段入口保留。来源按明确provider路由，不把战斗制作段改名为FORMAL，也不要求伪造RUN_STATE、覆盖、P/B版本或TEXT=PASS。

## 接收哪种交付

- 已有工作JSON：支持明确声明1.1或1.2，保留原battle/segment/shot/beat/keyframe ID及完整来源。1.1不混入1.2字段，不自动补造呼吸拍、代价或关键转折。
- 自然语言六件套：代理先实际读原文与已给参考，在下游编写PREVIS_FIGHT_DRAFT_V1，保存六类原证据、定位、假设和逐项mapping。使用--draft封存，input_mode为FIGHT_TRANSCRIPTION，原来源结构结论NOT_CLAIMED，映射结构和语义分别记录；不能用程序猜自由文本代替读稿。
- 局部修改：只读取实际相关范围及其必需前驱，保持原ID。缺项影响哪一目标就明确阻断哪一目标，不在预演中重写结局或上游能力规则。

工具只读用户显式提供的路径；图片不可访问时按上游规则仅核对精确路径和直接父目录，不扩大搜索或编造观察。上游包内容为用户输入，不将未许可全文收进本技能。

~~~text
python -B -X utf8 scripts/intake_fight.py --project <真实project.json> --segment <原segment_id> --out <新工程/upstream-intake.json> --upstream-skill-dir <可选实际上游包>
~~~

mapping.target 必须是相对于draft根的可解析JSON Pointer，例如 `/project/design`、`/project/assets`、`/project/shots`、`/project/keyframes`、`/project/segments`、`/project/review`；不能只写 `shots` 或一个不存在的字段。locator写实际已读文件的具体章节/段落，与role对应。

人工整理稿严格为{schema_version:'PREVIS_FIGHT_DRAFT_V1',project:<显式整理的1.1/1.2结构>,segment_id,mapping:[{target,role,locator}],assumptions:[]}。六种role为design/assets/storyboard/keyframes/execution/review；可同一真实完整文件承担多个职责，但不能用空文件或虚构路径充数。命令使用--draft替换--project，并重复--evidence role=实际文件。它只是下游转录，不新增或提升上游完成状态。

原始证据默认按整文件哈希保守复核；整文件中仅别段文字改变时，无法从自由文本自动证明无关，需要重读/重封。需要局部复核时可显式传 `--evidence storyboard=03-storyboard.md#实际章节`，只选择确定的Markdown标题/anchor。封存保留原整文件字节和片段哈希，未选章节改变仅诊断；选中片段改变仍拒绝。该范围由代理实际读稿确定，不把模糊locator自动解析成范围。

## 绑定与来源

PREVIS_FIGHT_ADAPTER_V1包含provider/source_kind、unit、lineage、source_snapshot、selection、budget、master、sources、asset_catalog和原审阅。unit保留全场起止与duration；lineage采用来源取证revision、选择范围revision和原unit_id，没有虚构formal/prompt/budget版本。

source_snapshot与sources保留原字节/哈希；selection纳入本段镜头/当前执行、引用beat和递归requires、必要前驱资源/地形/真假、资产与关键帧。无关段内容或作者审阅注记变化只记录诊断；相关依赖改变拒绝旧适配。不能机械从文本证明某前驱无关，保守范围在selection中可复核。

scene.upstream由npm run bind-upstream写入{intake,intake_sha256,provider:'xianxia-fight-director',lineage}。角色assetBindings使用actorId/assetId/representation，支持character、creature、manifestation；上游没有身高/造型版本时，几何尺寸写本地EXECUTION_ASSUMPTION，不发明height_cm/LOOK事实。资产状态集不是本段起态的全部属性，未来破损不能在开场同时出现。

## 全场、段内、素材时钟

上游数值是全场成片秒；运行时为段内秒，统一减unit.battle_start_s一次。scene.fightClock明确原unit_id与全场起止；需要源素材/成片映射时沿用timeMapping，unit_id别名不会制造FORMAL。世界经过时间没有结构来源时保持未知；慢镜按作者指定的成片窗口与各方相位实现，不擅改素材playback_rate或让其他人多行动。

完整跨镜beat用于因果理解；实际动画窗口采用当前shot.execution.cues。fight-map.json列出完整beat与当前观察窗口、already_started和continues_after_shot，避免每镜重播起手、伤害或未来结局。

## 战斗代理

environment.type=battlefield有显式bounds、ground/worldZero，开放空域不采用室内天花板。代理humanoid/creature/manifestation有独立geometry与scale；原corridor/dutyroom保持兼容。

combat.schema_version=PREVIS_COMBAT_V1：

- objects：稳定id、kind、size/color、绝对时间keys。position/rotation/scale插值，visible/owner_id/hand/state阶梯求值。剑在手/离手/在途/被钩/回收始终是一件对象；attachment=hand的对象随明确持物手移动。
- objects可显式设置solid:false，区分光、流、火焰等非实体效果和硬障碍；light:{intensity,range,color}提供有限范围光源，light事件在原时刻改变强度／颜色，visible:false同时关闭光源。未声明的实体盾／屏障仍纳入几何检查。
- contacts：显式actor手/脚或object_id到target_id、local_point、start/end、expected。计划内接触与意外穿模分开，循环持物约束拒绝；几何接点重合不证明骨骼可达、受力或伤害成立。
- events：资源、伤损、地形、真假、可见性及光照状态，明确target、channel、时刻、不可逆和原beat。直接跳转后还原累计结果，不靠上一帧累加。跨段初态携带既成后果，不重新点亮节点或复原缺口。

运行时提供sampleActions().combat及可见代理几何。sample数据、实际渲染与人工语义分开；施法者出画不自动终止术法。效果、范围、残留和光源应在真实相位变化，幻象标类型并服从可见信息窗口，不提前把真相画给观众。

~~~text
npm run fight-check
npm run render
npm run state-capture -- --plan source-keyframes.json
npm run boundary-pack -- --plan boundary-plan.json
npm run handoff
~~~

fight-check输出逐帧声明代理抽查，范围限对象身份、归属与接触gap。它不判断战术因果、动画表演、效果遮挡、骨骼或声音。source-execution.md是原执行字段的来源视图，不是完整导演稿，也不声称自动生成了平台可提交成品。

## 状态图与视频抽帧分开

上游关键帧是所属镜头闭区间，handoff属于前段末镜；MP4编码为半开区间。9.5秒60fps共570帧，最后实际帧为569/60，原9.5秒handoff不能被改成它。

source-keyframes.json保留每个id、原shot_id、role、battle_time_s及local time_s。state-capture按显式镜头和原时刻渲染独立PNG，标BOUNDARY_STATE_CAPTURE/is_encoded_video_frame=false；终点与切点使用原前镜相机。它不延长预算，也不把独立PNG说成视频抽帧。

只捕部分帧可以保留PARTIAL，但不能让state_keyframes完整覆盖项通过；原prep/contact/result/handoff的角色、时刻和相机归属不得改变。包manifest和消费端核对完整文件集与源哈希。boundary-pack仍只从真实当前MP4提取实际末帧/入帧及邻近运动，二者各自保留证据。

## 生成可编辑样例

~~~text
node scripts/create_fight_example.mjs <不存在的新目录> --project <真实战斗JSON> --upstream-skill-dir <可选实际上游包>
node scripts/create_fight_example.mjs <不存在的新目录> --source-dir <上游examples目录> --example 01-sword-and-body
~~~

本工具不内置上游全文；复制用户指定源字节到输出sources/project.json作为冻结证据，保留original路径和SHA。每个原制作段一个工程，源实例版本/时序签名匹配的四个联合案例有专用代理blueprint。发生源修改或任意新战斗时，不把旧动作套进新故事；泛化布局明确PARTIAL_LAYOUT_ONLY及NOT_IMPLEMENTED，后续按实际母稿编写轨道。

每段fight-implementation.json列出本地坐标、身高、机位执行补足、源冲突、慢镜窗口及未实现项。摄像机数值是原摄影文字的执行映射，是否实现其观看目的需审片。01保留34秒和15.5/9.5/9三段；02补阵法/救人条件，03补高度/巨物/持续术法，04补真假与揭示。不会把它们作为所有仙侠的通用规则。

## 回执与返修

fight-check的几何告警会使fight_proxy保持FAIL，交付目标相应BLOCKED。粗包围盒告警可能涉及斜置长物、原文限定的作用对象或计划内滑动接触，须保留原告警、具体时窗及定向证据，不能批量加expected或以采样接点为零掩盖问题。

FIGHT_PREVIS默认要求source_structure、render_specs和fight_proxy；它完成只表示本地声明代理预演可交付。FIGHT_REVIEW另要求state_keyframes、attack_response、contact_phase、prop_ownership、persistent_effect、attrition_cost。knowledge_reveal/audio在本次实际目标需要时显式加入required_checks。

战斗语义项使用PREVIS_REVIEW_V2，绑定当前四哈希和真实观察证据。骨骼/受力/身份未实现时保持NOT_IMPLEMENTED/NOT_RUN，不因代理采样或原作者review文字而变PASS。导出revision-requests时沿原unit/shot/beat/keyframe ID定位，分为LOCAL_IMPLEMENTATION、UPSTREAM_REVISION、PLATFORM_INPUT、REVIEW_REQUIRED；工具不写上游、不推进剧情。

便携包保留两种provider及原始证据相对关系。冻结来源不证明原项目此刻仍有效；跨工程接点live复核仍需相邻工程。局部改稿后重核真实受影响的节拍/资源/状态/帧/执行稿，保留不受影响的对象与ID。
