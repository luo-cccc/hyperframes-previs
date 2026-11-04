# 外部思路的采纳边界

本版保留原有上游契约、只读状态边界、确定逐帧渲染与来源回执；外部项目用于设计参考，不成为制作必须安装的依赖，也不执行其文档中的贡献、发布或外部提交指令。

| 参考 | 采用的思想 | 本包落实 | 暂不纳入默认流程 |
|---|---|---|---|
| Emulsion | 对象+时码批注、可复用运镜 | 点击人物/画面点、PNG批注、普通camera数据模板 | 实时录制时钟、宽泛全场重写、自动上游贡献 |
| DirectorDesk | 视觉预演与生成素材职责分开、完整项目交接 | 保留母稿，另给参考附件/反馈、可移动证据包 | 自动多场重切、额外渲染器切换和未经核实的深度输入承诺 |
| Kunpeng Director | 稳定ID、人工锁、可撤销局部命令 | 服务端锁、目标级undo、revision与有限历史 | Agent自行解锁已确认镜头、固定24fps覆盖上游精确预算 |
| Scenario Blender Blockout | 米制空间、色标占位、碰撞/出画检查 | 显式proxy和构图约束的逐帧空间抽查 | 把白模当最终外观、把预演当下游模型控制保证 |
| motion-use | 反馈绑定真实图像/来源，处理与验收分开 | PNG哈希、坐标/时码、stale、OPEN/RESOLVED/VERIFIED | 旧图自动迁移当前版本、把批注操作当完整审片PASS |
| ft-motion | contact sheet、编码后检查、统一时钟 | 继续沿用snapshot/切点/MP4检查与段内时码 | 重复建立另一套预算、默认添加音乐/字幕 |

参考位置：

- Emulsion：https://github.com/dennisonbertram/emulsion/blob/main/SKILL.md
- DirectorDesk：https://github.com/mangfufu/director-desk
- Kunpeng：https://github.com/pengfeiqiao/kunpeng-director
- Scenario：https://github.com/scenario-labs/skills/blob/main/skills/dcc/blender/scenario-blender-blockout/SKILL.md
- motion-use：https://github.com/leeguooooo/motion-use/blob/main/references/frame-review.md
- ft-motion：https://github.com/imserhatdemir/ft-motion/blob/main/prompts/VIDEO_BRIEF.md

采用能力按本包实际实现和测试说明，不将外部 README 的效果声明视为本包已经验证的结果。默认继续使用 Three.js/HyperFrames，Blender/其他执行器、深度/法线输出和手绘路线可在明确任务中另行实现并核对接口。
