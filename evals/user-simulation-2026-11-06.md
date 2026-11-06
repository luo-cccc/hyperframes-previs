# 用户模拟与子 agent 验证记录

> 历史用户模拟记录：保留早期启动、编辑与证据修复的实际范围。当前双上游、固定骨长和媒体状态见[验证索引](README.md)。

执行时间：2026-11-05 至 2026-11-06（Asia/Shanghai）。基线提交：`7fd0074`。

**已完成主流程用户模拟和 3 个子 agent 的独立验证，发现并修复 3 个产品问题。选定的最终主回归 137 项通过、定向回归 77 项通过、0 失败。** 这些数字是检查执行次数，包含针对同一行为的复测，不代表 214 个互不重复的用户场景。

## 分工与最终结果

| 执行者 / 范围 | 最终主回归 | 另行定向回归 |
|---|---:|---:|
| 父流程：真实界面操作、编辑后导出、失败保护 | 14 PASS / 0 FAIL | 初始化稳定复现 2 PASS |
| Zeno：草稿、锁、撤销、双页与并发保存 | 17 PASS / 0 FAIL | — |
| Averroes：真实 PNG 批注、来源时效、反馈包 | 42 PASS / 0 FAIL | 初始化及批注 13 PASS；包完整性 23 PASS |
| Mencius：合成上游 intake、版本范围与便携交付 | 64 PASS / 0 FAIL | manual 新旧片段契约 39 PASS |

编辑侧项来自基线隔离副本，编辑保存核心未改动；新初始化行为由父流程和批注侧项单独回归。其余修复的初始失败与修复后输出分开保留。

## 发现并修复的问题

### 1. P1：审片页偶发停留在加载中

iframe 先完成加载、studio.js 后注册 load 监听时，三维画面已经出现，但外层帧率、镜头和人物控件为空。父流程通过延迟 studio.js 请求直到 iframe 已加载的方式稳定复现；旧版即使等待仍为 0 个镜头控件。

修复 `assets/starter/src/studio.js`：已加载 iframe 会立即初始化，以文档身份避免重复绑定；重新加载时清理旧控件和草稿捕获状态。稳定触发修复后为 60 fps、3 个镜头、3 个角色；重复 load 不增加控件，另有 13 案界面与批注回归通过。

### 2. P2：手工母稿片段封存成功但无法绑定

manual intake 写旧 fragment 字段，绑定校验读取 selector，共享 Markdown 母稿因整文件与片段比较而失败。

修复 `scripts/finalize_manual_intake.py` 和 `assets/starter/scripts/check-upstream.mjs`：新封存采用与 JSON intake 相同的片段 selector、规范化及 selected_sha256；旧 manual 可恢复显式片段选择，仍按原始整文件哈希保守校验，不将 JSON 或旧证据静默升级。初次 63 PASS / 1 FAIL；修复后定向 39 案及完整 64 案均通过，上游源文件没有被写入。

### 3. P2：反馈包漏列文件时可能复用损坏证据

既有包只校验 manifest 自报的文件。把清单清空，或漏列一个已破坏的 PNG，旧版仍返回成功。

修复 `assets/starter/scripts/review-store.mjs`：从当前证据重建完整预期文件集合和字节，严格核对路径、数量、重复项、元数据与哈希，再读取所有预期文件。拒绝损坏包时保留上一次成功的顶层反馈。正常复用、清空／漏项／重复／错路径／错哈希、PNG 与 JSON 篡改等定向 23 案和完整 42 案均通过。

## 真实主流程与视频

父流程从新建、未安装依赖的显式 demo 工程开始，通过浏览器真实点击和键盘输入执行播放、1/60 秒步进、视角切换、点击选人、机位保存与重载、人物关键点修改、运镜预览保存和空间检查。随后安装锁定依赖并实际导出修改后的工程。

保存的修改为 S01 机位 X 偏移 -0.3 米、lead 的 4 秒关键点 X 为 -0.4 米、S02 沿视线推进 0.3 米。镜数仍为 3，时长仍为 12 秒。

| 视频检查 | 实测 |
|---|---|
| 分辨率 / 帧率 | 1280×720 / 60 fps |
| 时长 / 完整解码帧数 | 12.000 秒 / 720 帧 |
| 编码 | H.264 / yuv420p |
| 黑帧探测 | 未检出黑色区间 |
| 来源关联 | MP4、保存场景、渲染输入与成功回执一致 |
| 交付状态 | verified-render-current-inputs |

还实际模拟了非法奇数宽度和导出占用，均被拒绝且旧成功视频／回执保留。负向测试后最新 attempt 日志有意为 FAILED，成功 receipt 仍为 COMPLETED；未将模拟失败覆盖成成功记录。

## 证据与复现脚本

本地证据在以下独立输出目录，受现有 .gitignore 排除；本记录不声称这些大文件已随 Git 上传：

- [汇总 JSON](../outputs/user-simulation-summary-20261106/report.json)。
- [修复后主流程逐案记录](../outputs/user-sim-fixed-main-20261106/review/main-user-simulation.md)，[视频](../outputs/user-sim-fixed-main-20261106/renders/previs.mp4)，[实际解码抽帧](../outputs/user-sim-fixed-main-20261106/review/delivery-contact-sheet.png)。复现脚本为该工程的 user-journey.mjs、verify-delivery.py、verify-integration.mjs。
- [初始化修复前证据](../outputs/user-sim-init-regression-20261106/review/baseline-initialization.json) 与 [修复后证据](../outputs/user-sim-init-regression-20261106/review/fixed-initialization.json)，复现脚本为 [probe-initialization.mjs](../outputs/user-sim-init-regression-20261106/probe-initialization.mjs)。
- [编辑与并发最终报告](../outputs/user-sim-editor-20261105-e47b9c/FINAL-REPORT.md)，复现脚本为同目录 user-sim-tests.mjs。
- [批注与包完整性初始报告](../outputs/user-sim-review-20261105-2920c587/report.md)，[42案修复后索引](../outputs/user-sim-review-20261105-2920c587/latest-full-fixed.json)，[23案定向索引](../outputs/user-sim-review-20261105-2920c587/latest-integrity-fixed.json)，[13案初始化索引](../outputs/user-sim-review-20261105-2920c587/latest-studio-postfix.json)。复现脚本为同目录 run-review-fixed.mjs、run-integrity-fixed.mjs、run-studio-postfix.mjs。
- [上游修复与回归报告](../outputs/user-sim-upstream-20261105-8d73c2e9/fix-verification.md)，[64案完整回归](../outputs/user-sim-upstream-20261105-8d73c2e9/run-002/report.md)，[39案定向回归](../outputs/user-sim-upstream-20261105-8d73c2e9/targeted-postfix-001/report.md)。复现脚本为同目录 run_suite.py 和 test_manual_fragment_fix.py。

测试脚本只应对新建隔离工程或自己的合成夹具执行；其复位、篡改和失败注入不能用于真实制作工程。历史脚本问题（组合键 API、beforeunload 对话框、后台标签页操作、不可见背景变化夹具）已单列，不算产品缺陷。

## 验证范围

没有实际上游项目，来源侧使用明确 SYNTHETIC TEST ONLY 夹具，不构成真实 DONE/PASS 或制作授权。VERIFIED 流程测试仅验证证据登记规则，不代表最终模型或人类媒体验收。画面抽查覆盖 12 个实际解码样本，不声称已逐帧人工观看。声音、口型、最终视频模型生成、崩溃／断电恢复、多独立服务进程同时写入和真实第二磁盘 live intake 未测试。

本轮测试启动的浏览器和本地服务均已关闭，3 个子 agent 已收尾关闭。生产修复与本报告一并提交；运行截图、视频及原始测试证据按现有 .gitignore 保留在本地输出目录。
