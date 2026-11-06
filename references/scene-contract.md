# 场景、相机与动作契约

scene.json 是每个预演制作单元的可编辑数据源。单位为米、秒、弧度；世界 Y 向上，角色基准朝向 -Z；相机 FOV 为垂直视场角，单位为度。运行时 0 秒属于当前单元。

## 场景和来源

| 字段 | 当前职责 |
|---|---|
| schemaVersion、id、title | 场景格式与本地身份 |
| duration、width、height、fps | 原单元时长与技术输出规格；切点和时长须落帧网格 |
| environment.type | corridor、dutyroom 或 battlefield；几何和空间检查采用相同边界 |
| environment.bounds／ground／worldZero | battlefield 的显式边界、地面和世界原点；不套室内天花板 |
| actors[].id／role／color／height | 稳定 ID、源角色名、代理色标与米制身高 |
| actors[].geometry／scale | humanoid、creature、manifestation；支持固定标量或 XYZ 缩放 |
| actors[].path[] | {t,position:[x,y,z]}，覆盖整个单元的绝对时间路径 |
| upstream、assetBindings、adaptationMap | 实际来源、资产映射及执行补足；使用 bind-upstream 校验绑定 |
| fightClock | 原 unit_id 与全场成片起止；战斗时间只减一次段偏移 |
| timeMapping | 显式素材／段内／剪辑时间映射；没有来源时不发明时钟 |

corridor／dutyroom 的尺寸、门位和地板构造用于原演示。更换布局时同步几何与 spatial.obstacles，不能把演示房间当作任何剧本的默认舞台。

分镜的正式段身份见[分镜接入](upstream-adapter.md)，战斗的原 unit／shot／beat 身份见[战斗接入](fight-adapter.md)。没有绑定来源的新适配工程不能静默退回演示。

## 相机与时间

shots[].id／start／end 定义连续、无重叠的镜头。普通 seek 使用半开区间 [start,end)，MP4 最后一帧是 duration-1/fps。

相机可使用 camera.from／to 的平滑起终点，或覆盖本镜范围的 camera.keys 做线性多关键点采样。每个点含 position、target、fov；两种表示不能混用。camera.offset 采用世界坐标增量，同时作用于本镜的整条轨迹。Studio 的 X／Y／Z 是增量，不是完整坐标。

原关键状态用原 shot_id 的闭区间检查，可恰好位于镜尾或非整帧时刻。captureStateAt 和 state-capture 保留该原镜机位，独立 PNG 不冒充 MP4 帧。实际视频接点只从当前成功视频提取，详见[接点与时钟](boundary-previs.md)。

路径、门、注视、道具、资源与机位都按绝对 t 求值，不能靠上一帧累加。路径步态按已走距离计算；转场或分文件不能让已经完成的动作重新起手。慢镜不授权自动改播放速率。

## 手部与固定骨长

actors[].yawKeys／gazeKeys 定义朝向和注视；handKeys／footKeys 定义显式世界目标。门接触使用 actor.contacts，战斗接触使用 combat.contacts。目标轨道需要覆盖 [0,duration]。

手臂基准为身高 1.8 米角色的上臂 0.32 米、前臂 0.28 米，按角色的固定身高与竖向尺度确定世界骨长。双段代理 IK 通过肩肘旋转求手腕；实际网格抵消父级非均匀缩放，骨段不会为追随目标而伸缩。

| 采样字段 | 含义 |
|---|---|
| hands[side].target_position | 原请求目标；不会为消除间隙被改写 |
| hands[side].position | 求解后的实际手腕；物件手部附件和接触 gap 使用该位置 |
| hands[side].ik | 肩、肘、腕、固定长度、reachable、reason 与 reach_error_m |
| inspect().actors[id].renderedArms | 实际网格边界端点和世界长度，用于浏览器量测 |

超远或过近目标夹到可达范围；空间检查按采样容差报告 ARM_TARGET_UNREACHABLE。完整关节限位、肩胛、蹲身、俯身、支撑和受力并未自动实现。够不到时应按原文补姿态／路径或登记返修，不能用拉长手臂获得假接触。footKeys 仍是脚部代理目标，不据此宣称完成腿部 IK 或支撑验证。

combat.objects 的稳定对象、持物、非实体效果、光源和事件见[战斗接入](fight-adapter.md)。attachment_role=surface 仅用于手部附着 mark，使伤损随实际手腕移动；它不占用持物名额，普通物件仍拒绝同一手重复持物。

## 编辑元数据和检查范围

editLocks、editorHistory、deliveryGoal、reviewRouting、transitionMap 不绘制像素。通过保存 API 修改可保留 revision、目标级历史和锁，不能通过重写整场绕过已锁目标。其他实质场景、轨道、模型、素材和时钟仍进入渲染身份。

actor.radius、spatial.obstacles 和 framing.requiredActors／requiredObjects 只定义声明的代理检查范围。没有声明的需入画对象不猜测；没有警告不等于完整可见性或叙事通过。详见[编辑与审片](editor-review.md)。

导入模型或扩展布景时保持 renderAt(t)、hf-seek 和 readiness；素材加载完成才宣告 ready。实际修改摄影事实、预算或源动作时走上游返修；纯本地实现修复保留原 ID，并重导相关媒体与证据。
