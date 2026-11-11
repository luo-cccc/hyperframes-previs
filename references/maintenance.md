# 仓库维护

用户操作从 [README](../README.md) 和 [SKILL.md](../SKILL.md) 进入。本页记录维护位置、检查方式和本地文件边界。

## 目录与入口

| 位置 | 职责 |
|---|---|
| `README.md`、`SKILL.md`、`agents/openai.yaml` | 使用入口、技能路由和 UI 元数据 |
| `scripts/create_project.mjs` | 创建待绑定工程，或用 `--demo` 创建独立演示 |
| `scripts/create_dutyroom_example.mjs` | 两个独立值班室演示工程及跨段接点计划 |
| `scripts/create_fight_example.mjs` | 为当前战斗 JSON 的各原制作段生成已绑定布局 |
| `scripts/intake_storyboard.py`、`storyboard_contract.py` | 通用 SOURCE／DRAFT 封存与契约；`finalize_manual_intake.py` 是 DRAFT 快捷入口 |
| `scripts/intake_fight.py`、`fight_contract.py`、`fight_layers.py` | 战斗 1.3／六件套封存、结构校验和依赖选择 |
| `assets/starter/` | 自包含工程模板；工程级命令以这里的 `package.json` 为准 |
| `assets/starter/src/`、`scripts/` | 浏览器场景／编辑／采样逻辑，以及来源、保存、导出与交付工具 |
| `assets/starter/lib/` | 本地 Three.js 模块及许可证，预览直接使用 |
| `assets/examples/` | 值班室演示与战斗数值测试资源；战斗生成器不自动套用内部蓝图 |
| `tests/`、`tests/fixtures/` | 回归和合成夹具，不是制作来源 |
| `references/`、`evals/` | 现行操作指南与带日期的验证结果 |
| `work/`、`outputs/` | 本地工程、来源证据、媒体和诊断；不随模板分发 |

仓库根目录没有工程级 npm 入口；`npm run …` 应在生成的单元工程中执行。仓库级创建和回归使用 `node scripts/…`。

## 运行回归

需要 Node.js、Python 3；接点测试还需要 PATH 中的 FFmpeg／ffprobe：

~~~text
node scripts/check_project.mjs --report outputs/checks-new.json
~~~

报告必须是新路径，包含 Node 和 Python 的结果、原始输出及跳过计数。需要指定 Python 时设置 `PREVIS_PYTHON`。

可选真实战斗检查：将 `FIGHT_UPSTREAM_FIXTURES` 设为用户提供的当前上游包 `examples` 目录，验证其五例十五个原制作段。未提供目录时明确跳过。

可选浏览器检查使用已有环境：

~~~powershell
$env:PREVIS_BROWSER_TESTS = '1'
$env:PREVIS_COMBAT_BROWSER_TESTS = '1'
$env:PREVIS_PUPPETEER_MODULE = '<puppeteer-core模块文件>'
$env:PREVIS_BROWSER_EXECUTABLE = '<Chrome可执行文件>'
$env:PREVIS_COMBAT_LIB_DIR = '<已准备工程的lib目录>'
node scripts/check_project.mjs --report outputs/checks-browser-new.json
~~~

`PREVIS_RUNTIME_EVIDENCE`、`PREVIS_COMBAT_EVIDENCE` 可指定新的浏览器证据目录。没有执行的检查保留跳过状态，已有结果见[验证记录](../evals/README.md)。

| 修改范围 | 对应检查 |
|---|---|
| 通用／战斗来源与依赖 | `test_storyboard_contract.py`、`storyboard-integration.test.mjs`、`test_fight_contract.py`、`test_fight_layers.py` |
| 战斗工程生成与映射 | `fight-example.test.mjs`、`fight-integration.test.mjs` |
| 采样、编辑、IK 与状态恢复 | `runtime-contract.test.mjs`、`combat-runtime.test.mjs`、`limb-ik.test.mjs` |
| 接点、回执与目标状态 | `boundary-pack.test.mjs`、`review-receipt.test.mjs` |
| 文档 | 核对命令、字段、版本、相对链接及所述能力；技能格式可用现有 skill-creator 验证器检查 |

## 版本与文件管理

当前适配版本是 0.7.0。仅文档整理不升级版本；来源契约或运行行为变更时，同步 `assets/starter/scripts/adapter-version.mjs`、`scripts/storyboard_contract.py`、`scripts/fight_contract.py` 与入口说明。工程 `package.json` 的 1.0.0 是工程包版本。

保留用户输入、场景、intake、失败记录、渲染回执、媒体及其依赖。`node_modules`、`.hyperframes` 和 Python 缓存可重建；清理前确认没有活动任务，并核对明确的绝对目标。`.gitignore` 不表示目录可整批删除。`lib/` 和许可证是预览依赖。

操作指南只描述当前实现；带日期的验证记录只说明当时已检查的范围。已有冻结报告和哈希清单不随文档整理改写。移动交接按[便携包](portable-bundle.md)处理，重新生成媒体后再更新相应检查。
