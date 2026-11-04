# 场景数据与镜头连续性

`scene.json` 是模板的可编辑数据源。Three.js 使用米制、Y 向上，角色默认面向 -Z；摄像机使用透视投影，FOV 单位为度，时间单位为秒。

| 字段 | 用途 |
|---|---|
| `id/title/duration/width/height/fps` | 项目标识、标题、总时长与输出规格 |
| `environment` | 模板走廊的宽、高、长与门的位置；其他场景修改 `src/previs.js` 的搭景函数 |
| `actors[].id/role/color/height` | 稳定角色标识、叙事身份、预演色标、身高 |
| `actors[].path[]` | 按绝对秒排序的 `{t, position:[x,y,z]}` 路径点；首尾覆盖整场 |
| `shots[].id/start/end/beat` | 稳定镜头 ID、连续且无重叠的时间区间、动作意图 |
| `shots[].camera.from/to` | 运镜起终点，分别含 `position`、`target`、`fov`；在镜头内平滑插值 |
| `shots[].camera.offset` | `[dx,dy,dz]` 平移与 `target:[dx,dy,dz]`、`fov` 偏移；审片时可保存 |
| `door.openStart/openEnd` | 门从关闭到完全打开的绝对时间 |

适配上游时增加 `upstream`、`assetBindings` 和 `adaptationMap`，按 [upstream-adapter.md](upstream-adapter.md) 绑定来源，运行 `npm run bind-upstream`。本模板的绝对时间指当前正式段内统一的 0 秒时钟，不是整部作品或整场拼接时钟。

路径动画按段内绝对时间分段插值；步态按已走距离计算，因此快进、后退、重新导出不改变结果。适配模式重定时若影响上游预算，应交回上游返修；不能在换镜时重新启动走路循环。

镜头 offset 采用世界坐标，在同一镜头起终点同时生效。审片页的 X/Y/Z 是相对原镜头的增量，不是完整摄像机坐标。需要复杂轨迹时直接扩展镜头数据与采样函数。

可选编辑元数据 `editLocks={shots:{},actors:{}}`、`editorHistory={schemaVersion:1,entries:[]}` 与镜头事实分开。锁定是本地编辑承诺，不是上游角色状态；历史仅供目标级撤销。通过项目保存 API 修改以保留CAS与历史，Agent不得通过重写整场来绕过锁。

可选 `actor.radius`、`scene.spatial.obstacles` 和 `shot.framing` 仅用于明确的代理空间检查，详见 [editor-review.md](editor-review.md)。未声明的需入画角色不猜测，更换示例走廊布局时同时更新其检查边界。

## 改写成其他剧本

先列出场景尺寸、角色初始位置、关键动作时刻和镜头目的，然后修改 `scene.json`。模板验证器检查时序、ID、数值、路径覆盖与镜头覆盖；它不能替代视觉判断。穿模、脚滑、道具归属、脸部可见性和轴线需通过画面与俯视检查确认。

新建布局或导入 glTF 时修改 `src/previs.js`：保持 `renderAt(t)` 与 `hf-seek` 接口，加载器包含在 readiness 中，骨骼动作与道具事件都按绝对时间采样。大动作可先用占位姿态标出意图，不声称简易步态等同于动作捕捉。

镜头移动请求应转成可检查的修改。例如“左移 30 厘米并同时看见两个人”：保存原镜头、修改对应 offset 或轨迹、截取关键时刻、确认两人均在画幅内，再重新导出。不要只写“已优化运镜”而不给出结果。
