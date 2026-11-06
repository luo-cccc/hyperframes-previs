# 项目维护、检查与清理

本页用于维护本技能仓库。用户制作流程从[项目入口](../README.md)和 [SKILL.md](../SKILL.md)进入；历史结果从[验证索引](../evals/README.md)读取。

## 目录职责

| 位置 | 需要保留的内容 |
|---|---|
| README.md、SKILL.md、agents/openai.yaml | 用户入口、技能决策路由与 UI 元数据；保持两种上游描述一致 |
| scripts/create_project.mjs | 创建未绑定工程或显式独立演示 |
| scripts/create_dutyroom_example.mjs、create_fight_example.mjs | 联合演示与战斗源实例生成；不冒充任意剧本自动表演 |
| scripts/intake_storyboard.py、finalize_manual_intake.py、upstream_contract.py | storyboard 的 JSON 接收、手工封存和契约 |
| scripts/intake_fight.py、fight_contract.py | 战斗 JSON／六文档封存、选择范围和契约 |
| scripts/check_project.mjs | 发现并执行仓库 Node／Python 回归，记录失败和跳过 |
| assets/starter/ | 自包含工程模板；scene.json、Studio、运行脚本、渲染器及本地库 |
| assets/starter/src/ | scene/action/combat 数据、固定骨长、渲染、编辑与空间审计 |
| assets/starter/scripts/ | 绑定、来源、保存、导出、状态图、接点、回执及便携包 |
| assets/starter/lib/ | 浏览器运行库与 THREE-LICENSE.txt；保留许可，不能按缓存删掉 |
| assets/examples/ | 本项目编写的值班室与战斗数值蓝图、源签名；没有上游全文 |
| references/ | 按需读取的现行契约和操作指南 |
| tests/、tests/fixtures/ | 可执行测试与明确标识的原始合成夹具；不当作制作来源 |
| evals/ | 冻结验证记录和当前索引；历史失败不改写为通过 |
| work/、outputs/ | Git 忽略的本地工程、媒体、来源证据、缓存和诊断；不是天然垃圾目录 |

## 修改与版本

操作文档写当前行为，版本史放 evals/，避免把 0.4／0.5／0.6 的历史段落不断追加成现行规则。对照实际字段、命令及文件产物更新文档；没有运行的媒体或平台行为不写成已验证。

只改文档不需要提高适配版本。运行时或来源契约变更时，同步 assets/starter/scripts/adapter-version.mjs、scripts/upstream_contract.py、README、SKILL 和相应版本断言；项目 package.json 中的 1.0.0 是生成工程包名版本，不是适配器版本。

源事实、预算、原 ID、锁和已保存编辑按各自契约保留；代码修复不等于旧媒体已修好。涉及渲染输入时重新导出相关单元、状态图及接点，再核对 handoff；需要迁移交接时使用 bundle。

## 检查方法

基础回归：

~~~text
node scripts/check_project.mjs --report outputs/checks-new.json
~~~

该文件必须是新路径；失败时先读报告，不能只看末尾某个 PASS。FFmpeg／ffprobe 供实际媒体测试使用，Python 接收逻辑没有额外运行依赖。

真实浏览器测试需要显式已有环境；以下占位路径换成实际绝对路径：

~~~powershell
$env:PREVIS_BROWSER_TESTS = '1'
$env:PREVIS_COMBAT_BROWSER_TESTS = '1'
$env:PREVIS_PUPPETEER_MODULE = '<puppeteer-core的实际模块文件>'
$env:PREVIS_BROWSER_EXECUTABLE = '<实际Chrome可执行文件>'
$env:PREVIS_COMBAT_LIB_DIR = '<已准备工程的lib目录>'
node scripts/check_project.mjs --report outputs/checks-browser-new.json
~~~

可用 PREVIS_RUNTIME_EVIDENCE、PREVIS_COMBAT_EVIDENCE 指定新的证据目录。默认未启用浏览器时会明确跳过，不能引用当前 527／0 跳过的历史数字替代本次执行。技能 frontmatter 可用 skill-creator 的 quick_validate.py 验证；它只检查格式，不替代行为测试。

文档变更核对相对链接、命令名、版本和默认值，并执行 git diff --check。无需为文字措辞写与实现镜像的测试。

## 本地内容的保留与清理

- **保留**：用户输入、源仓库、scene／intake、原始失败、复现脚本、回执、PNG、MP4、便携 manifest 及其引用文件；最终可编辑工程与当前观看版。
- **可重建**：明确定位的 node_modules、任务 caches、.hyperframes、__pycache__；已确认无活动进程后再清理。保留正在使用的共享工具依赖，后续导出按锁文件 npm ci。
- **先核实**：零字节媒体、staging 和锁可能记录失败或进行中的任务；不能只按扩展名／大小删除。历史版本可标旧并建索引，不因结论不通过就删掉。

.gitignore 只说明哪些文件不提交，不说明它们可以删除。不要对 outputs/ 或整个工作区运行无差别递归清空。删除前解析绝对路径、确认仍在本工作区且不经过 reparse point，使用原生 LiteralPath 操作；保存清理清单并核对保留文件哈希。临时源与缓存清理应同一工具／shell 完成，避免字符串拼接路径。

本轮已清除 172 个可重建目录、480,654 个文件，逻辑体积约 9.50 GB；最终 0.6.1 发布工程的 1,550 个文件哈希全部保持。详细清单保留在本机 outputs/docs-cleanup-20261106/，不收入技能包。清理依赖不改变媒体来源身份，也不构成新一次媒体验收。

## 提交范围

提交源码、合成测试夹具、现行文档与验证记录。视频、用户源文、npm 依赖、浏览器 profile、任务缓存和本机绝对路径配置留在忽略目录。提交前检查 staged diff、仓库状态及所需验证；推送后核对远程提交与本地 HEAD。
