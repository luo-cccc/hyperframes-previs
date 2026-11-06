# 接点、代理动作与三种时钟

本模块用于已实现动作、时间映射与实际视频接点。分镜来源保留上游 0.4.1 的母稿、预算和 transition_plan/review；战斗来源保留原 unit／shot 与全场成片时钟。纯计划和实际素材分别保存，不自动增加切镜、正式段或平台任务。

## 接收与局部过期

新JSON intake使用SCOPED_STATE_V3；旧V2按原语义复核，不静默升级。source_script_ref.path/location均可用，冲突时拒绝。未提供真实上游包目录时upstream_provenance保持UNKNOWN；提供 --upstream-skill-dir 后记录包版本、Git提交及文档哈希，包的全局变动不成为剧情失效依据。

transition_context从本段相关、版本适用的原记录抽取plans、reviews及端点依赖。core事实与转场分开：母稿/预算/相关资产变动仍拒绝使用旧适配；仅相关连接变化使transitions.status=STALE，本段正确母稿与旧成功视频可保留，相关接点证据需要重新核对。其他段推进不应使本段失效。TEXT的status/scope/evidence共同参与新core指纹；缺少历史scope要明确记录，不能伪造人工核对。

## 确定求值的代理动作

所有新增轨迹均使用段内绝对秒，角度为弧度。未实现真实模型、动作捕捉、口型或声音时明确保留未检查状态。

- door.type=hinged-door：hinge为世界XYZ，size为[宽,高,厚]，closedYaw为关门朝向，swingSign为+1或-1。angleKeys=[{t,angle},...]显式覆盖0到duration；下一正式段可以从已半开的角度继续，不能重播前半动作。旧sliding-door的openStart/openEnd继续支持。
- actor.yawKeys=[{t,yaw},...]、gazeKeys=[{t,target:[x,y,z]},...]显式覆盖全段，线性采样，不猜最短转向或揭示时点。
- actor.contacts=[{hand:'left',targetId:'door',localPoint:[x,y,z],start,end}]将手部代理目标按当前门变换到世界坐标。局部点必须在门体内；同手相交职责被拒绝。它声明请求目标；0.6.1 的固定骨长 IK 另求实际手腕和真实 gap，够不到时报告 ARM_TARGET_UNREACHABLE。有限几何可达不证明关节限位或真实皮肤接触。
- actor.prop.type=key、hand='right'可保持道具随指定手移动；不因需要连接就凭空增加道具。原步态和block-rifle示例保持独立演示用途。
- camera.keys=[{t,position,target,fov},...]可表达多个运镜阶段，起止覆盖当前shot。旧from/to/offset保留；替换当前运镜模板会采用该模板自己的完整轨迹，不改变镜序或预算。

纯采样接口在src/action-data.js，时间映射在src/time-mapping.js；PREVIS.inspect()暴露代理状态用于核对非顺序采样。环境dutyroom有独立边界和铰链门几何，走廊仍按其原边界检查。动态门接触、手臂和像素遮挡不是空间代理检查的通用物理证明。

## 三时钟映射

可选scene.timeMapping：

~~~json
{
  "schema_version":"PREVIS_TIME_MAPPING_V1",
  "segments":[{
    "input_id":"A","formal_id":"FORMAL_1","source_version":"MEDIA-1",
    "source_duration_s":10,"source_start_s":1,"source_end_s":10,
    "segment_start_s":0,"segment_end_s":9,
    "edit_start_s":0,"edit_end_s":9,"playback_rate":1
  }]
}
~~~

source 是实际素材坐标，segment 是当前单元段内坐标，edit 是明确拼接计划的成片坐标。战斗映射可使用 unit_id 替代 formal_id，不把制作段制造成正式母稿；全场成片来源另由 fightClock 明确，世界动作经过时间仍未知。源区间、段区间和成片区间长度必须相等，段区间连续覆盖原预算；V1仅接受playback_rate=1，不用数据字段自行授予变速权。不同片段的edit区间可以按明确计划重叠，但这只是坐标映射，不是自动叠化或拼接。映射缺失时外部时钟为UNKNOWN/null，不把段内秒猜成素材或全片秒。

## 提取真实接点证据

先用npm run render产生当前MP4及成功来源回执，再运行：

~~~text
npm run boundary-pack
npm run boundary-pack -- --plan boundary-plan.json
npm run boundary-pack -- --plan boundary-plan.json --plan-only
~~~

未给plan时仅选择本工程内部切点。显式plan支持不同工程和素材内部选点，project相对plan文件目录；from.time_s是A最后保留的实际帧，to.time_s是B第一保留帧，不能使用exclusive end当不存在的尾帧。

~~~json
{
  "schema_version":"PREVIS_BOUNDARY_PLAN_V1",
  "connections":[{
    "id":"A-B","kind":"action",
    "from":{"project":".","shot_id":"S01","time_s":3.9833333333333334},
    "to":{"project":"../next","shot_id":"S01","time_s":0},
    "window_before_s":0.2,"window_after_s":0.2
  }]
}
~~~

数字示例为60fps；实际按源fps和所选镜号填写。缺省技术窗口按各端fps选择最接近0.2秒的整数帧（24fps为5帧，60fps为12帧），报告明确记录TECHNICAL_DEFAULT及实际秒数。用户显式指定的窗口必须整帧且不离开所选镜头；工具不自动截短或舍入显式数值。必要时扩大窗口并正常速度播放，不能把固定帧数当动态验收标准。仅实际绑定某条上游连接时才填写transition_id；显式ID必须在两端证明为当前有效记录，否则阻断实际提取，计划模式保留UNVERIFIED_TRANSITION。未填写ID的普通技术切点检查仍可用。

输出review/boundary-report.json与review/boundary-packages/<identity>/，含可独立打开的 index.html（角色/镜号/帧号/三时钟标签与短片）、两端短视频、原始PNG、联系表、三时钟、各 provider 的原身份／版本、源指纹及完整性manifest。短视频不携带音频；audio保持NOT_RUN。--plan-only只有条件计划，不生成或冒充真实帧；缺实际视频时frame_index_basis为PLANNED_SCENE_FRAME_GRID，video时钟标PLANNED，数值仅为拟定帧网格坐标。

接点内容身份排除锁、历史、目标等不绘像素元数据，源场景快照保存规范化渲染内容；原始文件取证哈希继续留在原渲染回执。来源不匹配、视频缺失、指定转场过期、文件被改或manifest漏项/重复/错误路径时明确拒绝，保留旧成功report。复用和回执消费都重核全部选定工程、计划和完整包，不只信任manifest自行列出的文件。包可独立查看；重验证live连接仍需原选定工程和计划，冻结材料不证明上游此刻仍有效。

## 联合演示

~~~text
node scripts/create_dutyroom_example.mjs outputs/dutyroom-check
~~~

生成F1（9秒）与F2（12秒）两个独立TEST/DEMO工程。分别npm ci、npm run validate、npm run render；在F1运行npm run boundary-pack -- --plan boundary-plan.json可提取跨段运动。F2接续半开角度及同一请求接点，不重新关门；手腕是否到达该点由当前固定骨长求解和检查决定。后段保留注视与原话轮的计划，未生成声音。

演示有明确测试标识，不等于真实上游授权、完整角色一致性或剧情媒体验收。其他遮挡/甩镜/声音连接按真实母稿实现；缺模糊、音轨或平台控制时在分项回执记录NOT_IMPLEMENTED/NOT_RUN。
