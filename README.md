# HyperFrames 分镜与战斗预演

版本 **0.7.0**。将已有分镜或战斗执行稿落实为可编辑的 Three.js 三维预演，通过 HyperFrames 导出参考视频。技能入口为 [SKILL.md](SKILL.md)。

| 输入 | 接入方式 |
|---|---|
| 通用分镜、导演稿或镜头文字 | [通用接入](references/upstream-adapter.md)：明确单元、镜头、段内时码和原稿；自由文字由代理阅读后整理 |
| xianxia-fight-director 战斗交付 | [战斗接入](references/fight-adapter.md)：当前工作 JSON 1.3，或六件套的人工转录 |

工具只读来源，写入自己的场景、媒体和回执。当前不兼容旧来源契约。战斗生成器只自动建立 `PARTIAL_LAYOUT_ONLY` 空间布局，完整动作与摄影仍需按原稿实现。

## 预览演示

需要 Node.js。模板已包含本地浏览器库，可以直接预览：

~~~text
node scripts/create_project.mjs work/demo --demo
cd work/demo
npm run validate
npm run studio
~~~

打开终端输出的地址；Windows 也可双击生成工程中的 `启动预演.cmd`。工程服务占用当前终端，其他命令另开终端运行。

## 制作工程

在仓库根目录选择入口：

~~~text
node scripts/create_project.mjs work/my-previs
node scripts/create_fight_example.mjs work/my-fight --project <实际战斗JSON>
~~~

第一个命令创建待绑定工程，随后按通用接入指南封存来源、实现 `scene.json` 和逐镜映射，再运行 `npm run bind-upstream`。第二个命令为战斗的每个原制作段生成独立工程，自动封存、绑定并校验布局。

以下命令在生成的单元工程内执行：

~~~text
npm run validate
npm run spatial-check
npm ci
npm run render
npm run handoff
~~~

战斗工程另运行 `npm run fight-check`；需要原状态图或真实视频接点时，按[运行指南](references/runtime.md)执行 `state-capture`、`boundary-pack`。Python 3 用于来源封存，仅使用标准库；FFmpeg／ffprobe 用于视频检查和接点提取。导出依赖由工程的 `package-lock.json` 锁定：HyperFrames 0.9.10、Three.js 0.187.0。

## 能力与边界

Studio 支持机位、FOV、人物路径、运镜模板、锁、局部撤销、PNG 批注与检查定位。当前画面使用代理几何；资产参考文件参与来源检查，不会自动加载成角色模型或贴图。手臂采用固定骨长双段代理 IK，够不到的目标保留真实间隙并报警。

默认 60 fps，时长和切点须准确落在帧网格。原状态 PNG 可以位于镜尾或非整帧时刻，与 MP4 抽帧分开记录。来源校验、代理检查和实际语义／画面／声音验收各有范围，详见[交付与检查](references/handoff.md)。

## 仓库导航

| 位置／事项 | 用途 |
|---|---|
| `scripts/` | 仓库级创建、封存及回归入口 |
| `assets/starter/` | 生成工程的完整模板；包含工程级 npm 命令、本地库和许可证 |
| `assets/examples/` | 值班室演示和内部战斗数值测试资源 |
| `tests/`、[验证记录](evals/README.md) | 可执行回归、合成夹具与已有验证范围 |
| [场景契约](references/scene-contract.md)、[运镜模板](references/camera-patterns.md) | 场景、动作、机位和时间数据 |
| [编辑与审片](references/editor-review.md)、[接点与时钟](references/boundary-previs.md) | 保存、批注、检查和视频接点 |
| [分项回执](references/scoped-receipts.md)、[便携包](references/portable-bundle.md) | 目标状态、证据、返修与移动交接 |
| [维护指南](references/maintenance.md) | 目录职责、测试、版本和本地文件管理 |

`work/`、`outputs/` 存放本地工程与证据，不属于模板分发内容。
