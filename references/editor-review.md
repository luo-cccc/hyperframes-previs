# 编辑、锁与画面反馈

通过 `npm run studio` 打开本地审片页。正式机位与自由观察共享同一场景；点击人物选择稳定角色 ID，点击空白处选择画面坐标。选框、路径线和自由视图不进入正式导出。

## 保存与局部撤销

机位面板修改当前镜头轨迹或 offset，运镜模板先生成预览。`保存当前机位` 保存整条当前轨迹；`清零偏移并保存` 只清零 offset；`撤销未保存预览` 不写文件。人物路径编辑只改所选关键点的位置，保留原时刻。具体相机语义见[运镜模板](camera-patterns.md)。

服务端按 scene 文件 revision 检测冲突，且只接受 camera、camera-track、path-point、set-lock 和目标级 undo。其他页面先保存时，旧请求拒绝并要求核对刷新后的数据；保存另一对象不会夹带未保存的机位预览。导出始终读取磁盘上的已保存数据。

`scene.editLocks.shots[shotId]`、`actors[actorId]` 用 `{locked,reason}` 锁定已保存目标。锁定目标的保存和撤销都被服务端拒绝，解锁须显式执行。

`scene.editorHistory` 最多保留 100 条局部 before/after。撤销只回退所选机位或角色最近一次未撤销编辑；当前值与历史 after 不一致时拒绝覆盖。锁记录不随撤销改变。原文件 revision 负责写入冲突，不能用排除编辑元数据后的渲染哈希代替它。

## 画面批注

1. 暂停，切回正式机位，保存或撤销未保存机位。
2. 选对象或画面位置并捕获。画面取最近有效视频帧时刻，隐藏选框后保存 PNG。
3. 填写意见，记录为 OPEN；完成修复可改 RESOLVED，单独提供验收证据后才可改 VERIFIED。

批注保存在 `review/annotations.json`，图片按字节哈希存于 `review/frames/`。来源记录包括镜头、时码/帧号、坐标、scene revision、渲染指纹和 intake 哈希；旧页面、来源变化或 PNG 损坏会使记录 stale，不能作为当前验收。

服务检查 PNG 完整性、尺寸和时间引用，不重新渲染来比对像素，因此捕获标为 `USER_CAPTURE_UNVERIFIED/pixel_verification=NOT_RUN`。画面意见与[分项审阅](scoped-receipts.md)是不同记录。

`npm run feedback` 导出 `handoff/feedback.md`、`feedback.json` 和自包含的 `feedback-packages/<identity>/`。交付整个反馈包，其中包括可用 PNG 与完整性 manifest；缺失或损坏图像单独标明。批注不会改写源稿或触发视频生成。

## 空间抽查

`npm run spatial-check` 默认逐导出帧采样，超过 20,000 个样本时拒绝自动降采样。需要调整时显式使用 `--every-frames` 或 `--max-samples`，例如 `npm run spatial-check -- --every-frames 2`；报告保留实际采样范围。

检查内容包括代理人物相交、环境边界、地面、室内天花板或显式空域，以及 `spatial.obstacles=[{id,min,max}]` 声明的 AABB。人物半径默认 0.22 米，可设 actor.radius。镜头只核对 `framing.requiredActors/requiredObjects`；mode 支持 center/full，margin 默认 0.02。

遮挡抽查采用代理中心射线，不等于完整轮廓或像素可见性。普通 handKeys、门接触和战斗接触都可报告 `ARM_TARGET_UNREACHABLE`；固定骨长和实际腕位见[场景契约](scene-contract.md)。战斗对象及接触还应运行 fight-check。报告无告警只表示声明的采样范围未见问题，实际画面和动作仍需审阅。

## 接点与交付面板

页面可运行战斗检查、原状态图捕获、视频接点提取和 handoff；按钮使用已保存数据。刷新交付状态会只读重核证据并撤销过期的完成结论，不改写已发布回执。接点计划与时钟见[接点说明](boundary-previs.md)，验收目标见[分项回执](scoped-receipts.md)。
