# 给下游视频模型的参考包

## 上游分镜适配模式

0.4.0 反馈由 `npm run feedback` 独立导出：`handoff/feedback.md/json` 以及包含PNG的 `handoff/feedback-packages/<identity>/`，状态与证据不塞进模型提示词。交付整个包目录。`npm run handoff` 仅在报告身份匹配时引用 `review/spatial-report.json`，否则标为 NOT_RUN_OR_STALE。

存在 `scene.upstream` 时，运行 `npm run handoff` 返回原上游母稿的逐字副本 `handoff/prompts.md`，另附 `reference-attachments.md`、`adaptation-map.json` 和 `previs-receipt.json`，不会套用走廊示例的提示词重新概括母稿。先读 [upstream-adapter.md](upstream-adapter.md)。

正式渲染使用 `npm run render`，生成来源关联的 `renders/render-receipt.json`。修改机位、人物、场景代码、素材或上游输入后应重新导出；视频存在但回执缺失/哈希不符时，返回包标为 `unverified-or-stale`，不能声称它对应当前母稿。精细动作、原台词与声轨等未实际审片的部分保留 NOT_RUN。

完成对实际视频的检查后，`adapter-review.json` 使用 `schema_version=PREVIS_REVIEW_V1`，保存 `status=CHECKED/PASS/FAIL`、实际范围 `scope`、非空 `evidence`、`unimplemented`、`upstream_revision_required`，并复制本次成功回执的 `scene_sha256/intake_sha256/render_inputs_sha256/video_sha256`。只有当前视频、来源和四项关联均一致才复用；旧格式、缺证据或代码/素材/视频变化时置为 `NOT_RUN`，保留旧审片文件作历史证据。

语义读稿检查与实际媒体检查都要注明范围。没有声音、口型或复杂动作时不能把 `unimplemented=[]` 当作都已实现；没有运行最终视频模型时其 MEDIA 保持 NOT_RUN。母稿副本不替代已经完成的模型专用适配稿。

以下角色/素材职责用于真实已绑定的参考包。0.4.0 删除运行时演示自动拼装“可提交提示词”的分支，未绑定的显式演示只输出 `demo-notes.md`，避免把示例取代上游母稿。

预演承载摄影机、相对位置、动作时刻与剪辑意图。人物图承载身份和服装，场景图承载环境与材质，道具图承载形状与归属。模型可能重新解释所有这些信息；先验证目标平台是否支持视频参考，以及当前的时长、张数和分辨率限制。

在项目中运行 `npm run handoff`，输出 `handoff/manifest.json`、`handoff/shots.csv` 与 `handoff/prompts.md`。模板未包含真实角色和场景图片：清单中的未绑定状态必须保留，不能虚构资产路径。

参考附加说明可承载以下职责，正式母稿不重复改写：

1. 绑定关系：预演色标/角色 ID 对应哪张人物参考图，哪个空间对应哪张场景图。
2. 必须保持：镜头景别和运动方向、人物相对位置、关键动作时刻、目标可见性、切点。
3. 可以自然化：步态、肢体微动作、布料、材质和环境细节。
4. 不应继承：色块模型外观、关节形状、辅助线、标签、审片 UI。
5. 连续性：前一镜结束状态和后一镜开始状态，包括朝向、手持道具和门体开合。

这些参考只提供制作依据，仍需绑定用户真实资产，并由上游模型适配按实际平台规则处理。一个参考视频包含多个镜头时，模型未必逐个保留；关键镜头可单独导出并在后期剪接。

如果需要从已经验证的 MP4 切镜，可用 FFmpeg 重新编码保证边界准确，例如 `ffmpeg -i renders/previs.mp4 -ss 4 -t 4 -an -c:v libx264 -crf 18 handoff/S02.mp4`。记录切片对应的正式段内时间；额外拼场时另记偏移，避免混用局部时钟。
