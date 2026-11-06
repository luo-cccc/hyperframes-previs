# HyperFrames 分镜与战斗预演

当前版本 **0.6.1**。将已交付的分镜或战斗执行稿制作成可编辑的 Three.js 三维预演，再用 HyperFrames 导出参考视频。技能入口为 [SKILL.md](SKILL.md)。

支持两个上游，保留各自的原 ID、时间、资产和来源证据：

| 来源 | 支持输入 | 接入指南 |
|---|---|---|
| script-to-storyboard-prompts | 有效正式段、同版预算、资产与首尾状态；状态 1.8/V3 文字、1.9/V4 JSON | [分镜接入](references/upstream-adapter.md) |
| xianxia-fight-director | 自然语言六件套，或工作 JSON 1.1／1.2 的原制作段 | [战斗接入](references/fight-adapter.md) |

本工具读取上游，写自己的预演工程与回执。上游剧情、制作覆盖、游标和完成状态仍由上游管理。

## 开始使用

验证环境：Node.js 22.22.2、Python 3、HyperFrames 0.9.10、Three.js 0.187.0。依赖由模板 package-lock.json 锁定；Python 接收工具只使用标准库。实际视频探测及接点提取需要 FFmpeg／ffprobe。

显式试用独立演示：

~~~text
node scripts/create_project.mjs work/demo --demo
cd work/demo
npm ci
npm run prepare-libs
npm run validate
npm run studio
~~~

打开终端输出的本地地址。Studio 占用当前终端；导出命令在同一工程的另一个终端执行。

正式分镜先使用下列入口创建未绑定工程，再按[接入指南](references/upstream-adapter.md)整理实际来源、资产和镜头映射：

~~~text
node scripts/create_project.mjs work/my-previs
~~~

已有战斗 JSON 可使用：

~~~text
node scripts/create_fight_example.mjs work/my-fight --project <真实project.json>
~~~

战斗生成器在新目录中为每个原制作段建立独立工程。四个已匹配源签名的案例有专用代理轨道；其他输入明确输出 PARTIAL_LAYOUT_ONLY，后续需按实际执行稿实现动作。仓库不内置上游全文。

## 检查与交付

在已绑定、已实现的制作单元目录执行：

~~~text
npm run validate
npm run lint
npm run spatial-check
npm run render
npm run handoff
~~~

战斗工程另运行 npm run fight-check。有 source-keyframes.json 时运行 npm run state-capture；boundary-plan.json 含连接且所有端点已渲染时，再运行 npm run boundary-pack。完整命令与次序见[战斗接入](references/fight-adapter.md)和[接点说明](references/boundary-previs.md)。

模板默认 **60 fps**，输出尺寸沿用源画幅并使用偶数像素。总时长和切点必须落在帧网格；不能为迎合帧率舍入上游预算。原关键状态可以位于非整帧时刻，通过独立 PNG 捕获。60fps 是离线编码规格，不是实时交互帧率保证。

Studio 支持机位、FOV、路径点、模板预览、锁、目标级撤销、PNG 批注和检查定位。导出读取已保存数据；画面批注、处理状态与附证据验收分别记录。

## 当前能力和限制

上臂／前臂采用固定骨长双段代理 IK。请求目标与实际手腕分别保留；够不到的目标产生真实间隙和 ARM_TARGET_UNREACHABLE，不通过拉长手臂消除间隙。

0.6.1 冻结回归为 **527 项通过，0 失败、0 跳过**，含真实浏览器和独立验证。四类战斗的 12 段视频共 **137 秒、8,220 帧**，另有 51 张原时刻状态 PNG、33 组实际视频接点。详细范围见[验证索引](evals/README.md)。

这些样例的动作轨道仍存在不可达目标等限制：当前 12 段 FIGHT_PREVIS 均保持 BLOCKED，共保留 131 组代理告警。软件测试通过不表示动作接触或整场语义验收完成；部分动作仍需蹲身、俯身等姿态排演。完整关节限位、腿部支撑、受力、声音口型、原角色身份和最终视频模型生成未被本包自动验收。

## 文档导航

| 需要做的事 | 文档 |
|---|---|
| 使用技能接收任务 | [SKILL.md](SKILL.md) |
| 接收正式分镜／战斗 | [分镜接入](references/upstream-adapter.md) · [战斗接入](references/fight-adapter.md) |
| 编写场景、相机、动作和手臂目标 | [场景契约](references/scene-contract.md) · [镜头复用](references/camera-patterns.md) |
| 编辑、锁、撤销、批注和空间检查 | [编辑与审片](references/editor-review.md) |
| 运行、导出、指纹和状态捕获 | [运行时](references/runtime.md) |
| 处理时间映射和真实视频接点 | [接点与时钟](references/boundary-previs.md) |
| 返回文件、验收目标和返修 | [交付清单](references/handoff.md) · [分项回执](references/scoped-receipts.md) |
| 移动工程或离线交接 | [便携包](references/portable-bundle.md) |
| 维护目录、检查和清理 | [维护指南](references/maintenance.md) |
| 查验证结论和历史修复 | [验证索引](evals/README.md) |

仓库中的 tests/ 是可执行契约回归，入口为 node scripts/check_project.mjs。默认运行会明确跳过未启用的真实浏览器项；启用方法见维护指南。历史记录中的 outputs/ 链接属于本机证据，Git 仓库不包含视频、缓存、依赖或上游正文。
