# 场景、相机与动作契约

`scene.json` 是单个制作单元的数据源。单位为米、秒、弧度；世界 Y 向上，角色基准朝向 -Z，相机 FOV 为垂直角度。时间从当前单元 0 秒开始。

## 主要字段

| 字段 | 要求或作用 |
|---|---|
| schemaVersion、id、title | schemaVersion=1；本地 id 为小写字母、数字和连字符组成的 slug |
| duration、width、height、fps | 时长为正；尺寸是正偶数；fps 为 1–240；时长和切点落在整帧上 |
| environment.type | corridor、dutyroom、battlefield |
| environment.bounds／ground／worldZero | battlefield 显式声明 min/max、地面 y 和世界地标；不套室内天花板 |
| actors[].id／color／height | 唯一稳定 ID、#RRGGBB 色标、正值米制身高；actors=[] 合法 |
| actors[].geometry／scale | humanoid、creature、manifestation；可选正标量或 XYZ 缩放 |
| actors[].path | 至少两个 `{t,position:[x,y,z]}`，从 0 覆盖整个单元，时刻递增 |
| shots | 按原顺序连续覆盖全长，ID 唯一，每镜包含有效相机 |
| upstream、assetBindings、adaptationMap | 来源身份、资产对应与逐镜实现映射，由 bind-upstream 复核 |
| fightClock | 战斗原 unit_id 与全场成片起止 |
| timeMapping | 已知素材／段内／剪辑坐标映射，见[时钟规则](boundary-previs.md) |

corridor/dutyroom 是具体演示布景。改空间结构时同步渲染几何和 `spatial.obstacles`，不把演示走廊当通用舞台。输入身份及素材要求分别见[通用分镜](upstream-adapter.md)和[战斗接入](fight-adapter.md)。

当前角色、器物与环境采用 Three.js 代理几何。`appearanceReference` 保存素材来源并进入文件检查与指纹，不会自动应用为贴图或真实角色模型；这类呈现需要另写场景实现。

## 相机

每镜相机在以下两种轨迹中选一种，并包含 `offset:{position:[x,y,z],target:[x,y,z],fov:0}`：

- `camera.from/to`：起终点各含 position、target、fov，以 smooth easing 插值。
- `camera.keys`：至少两个 `{t,position,target,fov}`，精确覆盖本镜 [start,end]；默认线性，可设 `interpolation:'smooth'`。

FOV 含偏移后须在 1–150 度之间。offset 是对整条轨迹的世界坐标增量；Studio 的 X/Y/Z 也是增量。模板替换整个当前镜头轨迹，见[运镜与复用](camera-patterns.md)。

## 动作轨道

所有轨道按段内绝对 t 求值。yawKeys、gazeKeys、手脚目标及铰链门 angleKeys 至少两点，明确覆盖 [0,duration]；角度直接插值，不推测最短转向。

| 字段 | 当前表示 |
|---|---|
| actor.yawKeys／gazeKeys | `{t,yaw}` 或 `{t,target:[x,y,z]}` |
| actor.handKeys／footKeys | left/right 下的 `{t,position:[x,y,z]}` 世界目标 |
| door.type=hinged-door | hinge、size、closedYaw、swingSign 和 angleKeys；门局部 X=[0,宽]、Y=[0,高] |
| door.type=sliding-door | openStart/openEnd 内的滑动事件 |
| actor.contacts | hand、门 targetId、门内 localPoint、start/end；同手不能重叠 |
| actor.prop | key 需明确持物手；block-rifle 为演示代理 |
| combat | 战斗对象、接触、状态事件和光源，见[战斗接入](fight-adapter.md) |

## 固定骨长与检查边界

1.8 米代理角色的上臂基准 0.32 米、前臂 0.28 米，随固定身高及竖向缩放确定世界骨长。双段 IK 求实际腕位，网格抵消父级非均匀缩放；目标超远或过近时保留可达边界和真实间隙。

| 采样值 | 含义 |
|---|---|
| hands[side].target_position | 原请求目标 |
| hands[side].position | 实际求得腕位，持物附件与接触 gap 使用它 |
| hands[side].ik | 肩肘腕、骨长、reachable、reason、reach_error_m |
| inspect().actors[id].renderedArms | 实际网格骨段端点及世界长度 |

`ARM_TARGET_UNREACHABLE` 需通过原稿允许的姿态／路径修复或返修处理。footKeys 仍是脚部目标；当前代理不验证完整关节限位、腿部支撑或受力。`attachment_role:surface` 仅给手部伤损 mark 使用，不占持物名额。

`actor.radius`、`spatial.obstacles`、`framing.requiredActors/requiredObjects` 定义声明的抽查范围；没有告警不等于像素可见性或叙事通过。编辑元数据、锁与抽查说明见[编辑与审片](editor-review.md)。
