# Paseo Conversation View · 对话视图

为当前 agent 提供可以直接聊天的对话视图：

- **A 正文**：默认视图，突出回答，按需展开执行过程。
- **B 执行**：宽屏分栏查看过程与回答，窄屏按顺序展示。
- **C 轮次**：按提问分组，方便回看历史。

阅读时固定当前轮的提问摘要，可展开全文或定位原提问。支持历史加载与实时更新；回看历史时暂停跟随新输出。

## 本地安装

确认目标 daemon 已启用插件。在 daemon 所在机器安装本目录：

```bash
paseo plugin install /absolute/path/to/conversation-view
paseo plugin ls conversation-view
```

打开一个 agent，在输入框提交 `/reader`，或在 Command Center（⌘K / Ctrl+K）选择“打开对话视图”。A/B/C 共用底部输入框，可直接发送消息和停止生成；权限与问题在输入框上方处理。Enter 换行，⌘Enter / Ctrl+Enter 发送；发送失败保留草稿供重试。Agent 执行中发送新消息会中断当前执行，按钮会显示“中断并发送”。附件、模型切换和未支持的问题格式可使用“原生对话”入口。

客户端通过公开 SDK 读取时间线、发送消息和处理权限。一个薄后端通过官方 Paseo CLI 停止生成，显式使用 daemon 继承的 `PASEO_HOME` 和 `PASEO_CLI`；缺少 home 时拒绝执行，避免连错 daemon。不替换原生对话页，不使用 DOM，也不依赖此前吸顶实验对宿主 overlay 的改动。安装和更新无需重启 daemon。

## 开发与验证

```bash
npm ci
npm run typecheck
npm pack --dry-run
```

当前 SDK 检查目标为已发布的 `@getpaseo/plugin@0.10.3`，客户端与 daemon 都需满足 manifest 的版本要求。版本范围不代表已逐一验证所有版本。使用 React Native 组件与宿主主题；真实 iOS / Android 上的滚动、吸顶和长对话性能仍需验证。

当前 Markdown 展示范围包含正文、链接、表格、列表和代码块，尚未集成 Mermaid。切换视图保留轮次内像素偏移；不同排版无法保证停在同一句。补历史若恰好补全首个未完整加载的轮次，阅读位置仍可能偏移，需进一步实现文本片段锚点。软件包保留 `private: true`，当前用于本地安装，未发布到 npm。
