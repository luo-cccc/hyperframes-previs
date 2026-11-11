# 状态图、视频接点与时钟

本页区分原时刻状态图和实际视频抽帧，并说明跨工程连接与时间映射。动作轨道及门接触字段见[场景契约](scene-contract.md)。

## 原状态与编码帧

普通镜头播放采用 [start,end)，视频最后一帧位于 duration−1/fps。原关键状态可以位于镜头闭区间 [start,end]，包括非整帧时刻和前镜终点；9.5 秒、60fps 的视频有 570 帧，末帧为 569/60 秒，原 9.5 秒交接状态需另捕。

`npm run state-capture` 默认读取项目根目录 `source-keyframes.json`（`PREVIS_SOURCE_KEYFRAMES_V1`）。计划逐项给出 id、shot_id、role、段内 time_s，可带 battle_time_s；role 为 single/prep/contact/result/handoff。程序在明确指定的原镜头机位捕获独立 PNG，保留 `BOUNDARY_STATE_CAPTURE/is_encoded_video_frame=false`，不延长预算。战斗源的帧身份、角色和原时刻不允许改写；只捕部分帧会记录 PARTIAL，不能让完整覆盖检查通过。

状态包位于 `review/state-captures/`，报告为 `review/state-capture-report.json`。CLI 不覆盖已有包，重复捕获选新的 `--out`；Studio 会先复核并复用有效报告。此类 PNG 不承担 MP4 抽帧或运动连续性证据。

## 三种时间映射

运行时始终使用当前单元 0 秒起的 segment 时间。已有素材和明确剪辑计划可提供 `scene.timeMapping`，例如一个 9 秒单元：

~~~json
{
  "schema_version":"PREVIS_TIME_MAPPING_V1",
  "segments":[{
    "input_id":"A","unit_id":"scene-entrance","source_version":"MEDIA-1",
    "source_duration_s":10,"source_start_s":1,"source_end_s":10,
    "segment_start_s":0,"segment_end_s":9,
    "edit_start_s":0,"edit_end_s":9,"playback_rate":1
  }]
}
~~~

source 表示素材秒，segment 表示当前单元秒，edit 表示明确拼接计划的成片秒。各区间长度相等，segment 连续覆盖原预算；当前只接受 playback_rate=1。映射不自动变速、叠化或拼接；缺少映射时外部时钟为 UNKNOWN/null。战斗另用 fightClock 保留全场成片偏移，换算到段内时只减一次，不能把成片时间当世界经过时间。

## 提取视频接点

先用 `npm run render` 生成当前 MP4 和成功回执，再运行：

~~~text
npm run boundary-pack
npm run boundary-pack -- --plan boundary-plan.json
npm run boundary-pack -- --plan boundary-plan.json --plan-only
~~~

未指定计划时仅选择本工程内部切点。跨工程或素材内部选点需显式 `PREVIS_BOUNDARY_PLAN_V1`；project 相对计划文件目录：

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

from 是 A 最后保留的实际帧，to 是 B 第一保留帧，不能用 exclusive end 代替不存在的尾帧。上例按 60fps 填写；所选帧与显式窗口必须落在各自帧网格和镜头范围内，程序不截短或舍入。省略窗口时，按各端 fps 取最接近 0.2 秒的整数帧，最少一帧，标记 TECHNICAL_DEFAULT；这是采样选择，不是验收门槛。

仅当源稿确有登记时填写 transition_id；该 ID 必须在两端的当前逐 ID 连接记录中唯一且有效。未知、重复或过期记录阻断真实提取，plan-only 则保留 UNVERIFIED_TRANSITION。普通硬切可不填 ID。

## 输出与复核

输出 `review/boundary-report.json` 和 `review/boundary-packages/<identity>/`，包括独立查看页、两端短片、原始 PNG、联系表、角色/镜号/帧号/时钟、来源身份及完整性 manifest。短片无音频；画面、运动与声音验收分别记录，见[分项回执](scoped-receipts.md)。

plan-only 只生成计划资料，不生成真实 PNG/短片；没有视频时帧坐标标为 PLANNED_SCENE_FRAME_GRID。实际包复用和 handoff 均重核所选工程、视频、回执、计划、转场依赖及完整文件集，冻结包不能证明原项目此刻仍有效。离线交接见[便携包](portable-bundle.md)。
