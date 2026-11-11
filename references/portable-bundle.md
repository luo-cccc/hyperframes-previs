# 可移动预演包

将已绑定工程及其明确来源一起打包：

~~~text
node scripts/bundle.mjs --project <预演项目> --out <项目外不存在的新目录>
~~~

工具复制项目内所有非排除文件，并补入 intake.sources、appearanceReference 和渲染指纹明确列出的项目外依赖。输出在稀疏 `tree/` 下保留相对路径关系；scene、intake、既有媒体和回执均按原字节复制。

`bundle-manifest.json` 的 project_root 指向运行目录，entry_html 指向 Studio，start_command 为 `node scripts/serve.mjs`。模板 lib/ 保留时可直接用 Node 预览；重新导出或使用 HyperFrames 命令再运行 npm ci。支持当前 storyboard 和 xianxia-fight-director 两种来源。

## 范围与限制

- 输出目录必须新建且位于源项目之外；保存、渲染、状态捕获、接点或 handoff 锁未释放时拒绝打包。
- 排除 node_modules、.hyperframes、.git、临时、日志和锁文件；保留浏览器运行库与许可。
- 外部来源必须是可维持关系的相对文件引用。绝对路径、URI、跨盘关系或符号链接需先在新修订中显式本地化并重新绑定；打包器不改写引用。
- 只携带已明确引用的外部素材，不能凭路径字符串声称未交接材料已可复核。

复制前后复核来源选择范围、渲染输入和每个文件哈希。完整成功才写完成 manifest；失败留下的部分目录仅供诊断。交付整个 bundle，不能再次只压缩其中的单元子目录而丢掉兄弟依赖。

包内来源标为 READ_ONLY_EVIDENCE_SNAPSHOT，记录首次证据哈希及实际复制哈希。它支持该冻结版本的预演复核，不证明活源此刻仍有效；打包也不产生新渲染。

接点包的 PNG、短片和查看页可离线阅读，但重新核对跨工程连接仍需要所选相邻工程与原计划。依赖工程未一起交接时，只能保留其历史证据范围。文件职责见[交付清单](handoff.md)，清理规则见[维护指南](maintenance.md)。
