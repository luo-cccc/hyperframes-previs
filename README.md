# HyperFrames 分镜预演适配 Skill

当前版本：**0.4.0**。技能入口：[SKILL.md](SKILL.md)。

接收 [script-to-storyboard-prompts](https://github.com/luo-cccc/script-to-storyboard-prompts) 已交付的有效正式母稿、同版预算、人物/场景/道具资产与首尾状态，制作可编辑的 Three.js 三维预演，再通过 HyperFrames 逐帧导出参考视频。

保留上游段号、镜序、时码、台词与来源版本。它是可选的下游媒体适配，不重跑上游七步，不推进上游制作覆盖或原文游标。

## 能力

- 点击人物或画面位置，记录带对象 ID、镜号、帧号、坐标与来源的 PNG 批注。
- 调整机位、注视点、FOV、人物路径关键点；当前镜头运镜模板先预览再保存。
- 服务端镜头/走位锁、目标级撤销、版本冲突保护与有限编辑历史。
- 按导出帧抽查代理相交、边界、显式障碍及明确要求入画的角色。
- 干净 MP4、原母稿副本、参考附加说明、独立反馈包和可移动证据工程。

画面批注的待处理、已处理与附证据验收分开；旧来源自动标过期。代理检查没有警告不等于完整媒体验收，预演也不保证下游模型精确跟随。

## 接入

将本仓库作为一个完整技能目录使用，读取 `SKILL.md`。示例请求：

```text
使用 $hyperframes-previs，接收指定项目已经交付的 FORMAL_1 / P1 母稿、
同版预算与资产做三维预演。保留镜序和时长，检查走位与遮挡，
交付可编辑项目、参考视频和实际反馈。
```

新项目起点：

```text
node scripts/create_project.mjs /path/to/new-previs-project
```

随后按入口与[上游接入契约](references/upstream-adapter.md)读取真实产物、替换示例场景、填写来源/资产/镜头映射并绑定。模板不是自动剧本解析器；尚未绑定的工程会拒绝退回演示输出。

仅试运行独立演示时，可显式创建：

```text
node scripts/create_project.mjs /path/to/demo --demo
```

在生成的工程中执行 `npm ci`、`npm run prepare-libs`、`npm run studio`。浏览器打开服务实际输出的本地地址。重新渲染使用 `npm run render`，不要直接打开本地 HTML 文件。

模板默认输出 **60 fps**。修改 `scene.json` 中的 `fps` 后运行 `npm run validate` 同步导出入口；总时长与各镜头切点必须落在所选帧率的整帧上，不能为适配帧率修改上游预算。

## 文档

| 内容 | 位置 |
|---|---|
| 技能入口与工作流 | [SKILL.md](SKILL.md) |
| 上游版本、输入与返修边界 | [upstream-adapter.md](references/upstream-adapter.md) |
| 编辑、锁、撤销、批注与空间抽查 | [editor-review.md](references/editor-review.md) |
| 场景字段与时钟 | [scene-contract.md](references/scene-contract.md) |
| 渲染、来源指纹与失败处理 | [runtime.md](references/runtime.md) |
| 返回视频模型的参考包 | [handoff.md](references/handoff.md) |
| 可移动工程与冻结证据 | [portable-bundle.md](references/portable-bundle.md) |
| 采纳的设计与暂缓能力 | [adopted-designs.md](references/adopted-designs.md) |
| 用户使用回归场景 | [user-scenarios.md](evals/user-scenarios.md) |
| 60 fps 实测记录 | [60fps-smoke-2026-11-05.md](evals/60fps-smoke-2026-11-05.md) |

## 运行与验证边界

验证基线为 Node.js 22.22.2、HyperFrames 0.9.10、Three.js 0.187.0；Python 提取工具只用标准库。模板包含本地 Three.js 浏览器文件，其 MIT 许可保留在 [THREE-LICENSE.txt](assets/starter/lib/THREE-LICENSE.txt)。

此前已完成隔离用户模拟、锁/撤销/批注/来源回归，以及真实 12 秒、1280×720、24fps、288 帧的 HyperFrames 导出。默认值现已调整为 60 fps，并于 2026-11-05 完成同规格 12 秒、60 fps、720 帧的实际导出、完整解码、帧数探测、切点及非顺序跳转检查。仓库中的 `evals/user-scenarios.md` 是回归场景说明，不应描述为已包含完整自动化测试套件。

示例使用色标占位人物与基础步态。声音、口型、复杂动作和最终视频模型生成未在该示例中验证。捕获 PNG 标为 `USER_CAPTURE_UNVERIFIED`，服务检查文件完整性与来源引用，不声称已重渲染比较像素。
