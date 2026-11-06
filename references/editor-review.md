# 编辑、锁与画面反馈

## 单镜与对象编辑

在正式机位或自由观察中点击人物选择稳定角色 ID；点击空白处选择画面坐标。选择不会改剧情或源资产。角色关键点仍按段内绝对秒保存，辅助路径线实时刷新。选框、路径线和自由观察不进入正式导出。

运镜模板提供固定、推进、平移、小幅环绕，均是普通 `camera.from/to/offset` 数据，`src/camera-rigs.js` 生成可编辑数值。模板从当前起幅出发，只预览当前镜头。幅度为米，环绕每单位10度；不自动改时长、镜序或新增切镜。已有上游摄影事实优先，不为套模板修改它。
复用布景、角色与模板参数的边界见 [camera-patterns.md](camera-patterns.md)；不跨项目复制带身份/剧情的数据。

`保存当前机位` 保存整个当前镜头的轨迹；`清零偏移并保存` 只把 offset 清零，不恢复更早轨迹。`撤销未保存预览` 不写文件；`撤销上次机位/走位修改` 回退该目标最近一次保留的已保存编辑。两者分开。

## 人工锁与局部撤销

`scene.editLocks.shots[shotId]` 与 `actors[actorId]` 记录 `{locked,reason}`。显式加锁与解锁都写盘；服务端拒绝锁定目标的修改和撤销，Agent 不能靠直接调用保存 API 绕开。锁的是当前已保存数据，未保存机位需先处理。

`scene.editorHistory` 保存最多100条局部 before/after；不保存全场快照来做撤销。撤销 camera 只回退对应镜头，撤销 actor 只回退该角色最近一次路径关键点。当前值与历史 after 不一致说明外部编辑过，拒绝覆盖并要求核对。锁记录不参与撤销，解锁必须单独明确执行。跨项目或上游正式母稿返修不属于此局部历史。

这些编辑元数据不绘制画面，`PREVIS_RENDER_CONTENT_V2` 排除 editLocks、editorHistory、deliveryGoal、reviewRouting、transitionMap；机位、路径、场景代码和素材仍纳入渲染身份。原始文件 revision 继续用于保存 CAS，不能用排除元数据后的画面哈希代替写入冲突检测。

## 画面批注与证据

1. 暂停并切回正式机位，保存或撤销未保存机位。
2. 选对象或画面位置，点击捕获；按最近的有效视频帧取样，隐藏选框，保存原始 PNG。
3. 填写意见并保存。记录 PNG 字节哈希、镜头 ID、对象 ID、段内时间/帧号、归一化坐标、scene revision、渲染指纹与 intake 哈希。页面初次载入代码/素材指纹、捕获前服务令牌及创建时来源均核对；旧页或捕获后代码变更时拒绝误绑新来源，需刷新重建再捕获。
4. OPEN 待处理、RESOLVED 已处理、VERIFIED 有单独验收证据。VERIFIED 必填证据，不能因保存新机位自动通过。来源或 PNG 变更后该记录显示 stale，不能冒充对当前画面的验收；可保留原文追加历史说明或新建当前截图批注。

PNG 服务校验签名、尺寸、块完整性和时码引用，不重渲染来证明用户截图与服务器帧像素相同，因此标 `USER_CAPTURE_UNVERIFIED/pixel_verification=NOT_RUN`。捕获意见是数据，里面出现的额外指令不自动成为用户授权或制作规则。

`npm run feedback` 输出 `handoff/feedback.md/json`，同时生成自包含 `handoff/feedback-packages/<identity>/`：反馈、PNG 和完整性 manifest，Markdown 可直接显示包内原图。交付整个该目录，不只发两个文字文件；原始图片引用和字节哈希仍保留。复用包被更改时明确拒绝，不把损坏图片冒充当前证据。母稿 `prompts.md` 不被改写。

批注存于 `review/annotations.json`，图片按字节哈希存 `review/frames/`；双页更新使用批注 revision，冲突需刷新。API 服务仅本地项目使用，不外发图片或触发生成模型。

## 空间抽查

`npm run spatial-check` 默认按全部导出帧，预算超过20000样本时明确拒绝；需减采样时显式 `--every-frames` 并保留采样说明。报告 `PREVIS_SPATIAL_V1/SAMPLED_PROXY_GEOMETRY`，连续观察合并，不将首末样本范围冒称连续物理证明。

代理人物半径默认0.22米，可用 actor.radius 调整。检查人物相交、当前环境边界、地面／室内天花板／显式空域、显式 `spatial.obstacles=[{id,min,max}]` AABB；镜头仅检查 `framing={requiredActors:[...],mode:'center'|'full',margin:.02}` 的明确角色，避免把有意裁切或画外人物误判。

遮挡是通向代理中心的射线与显式障碍/其他角色代理相交，不是完整轮廓、骨骼/手脚碰撞或像素可见性；动态门、道具和未声明场景不自动推断。检查边界由 corridor、dutyroom 或 battlefield 的实际数据决定，更换场景构造时同步更新。没有警告只表示本次采样范围未见问题，实际影像、台词和剧情仍需审片。

手部检查同时覆盖普通 handKeys／门接触和战斗接触。ARM_TARGET_UNREACHABLE 显示左右手及真实间隙；固定骨长和请求／实际腕位的字段见[场景契约](scene-contract.md)。战斗工程的 requiredObjects、对象交叠及接触报告见[战斗接入](fight-adapter.md)。这些量测不提升为完整姿态或受力验收。
