# Paseo Conversation View · 原生对话渲染

直接在 Paseo 原生对话时间线中增强回答、思考与工具记录。插件不创建新的对话页或输入框；发送、停止、权限、附件和模型选择由原生对话负责。

回答使用成熟 Markdown 引擎、流式文本节奏与完成后的复制按钮，支持嵌套列表、表格、代码、引用和删除线。图片与文件链接保留宿主渲染，以保住资源解析和文件导航。思考和工具记录可折叠，工具失败保持可见。含 Mermaid 的回答交给已安装的 Mermaid 插件，包括尚未闭合的流式代码块。

## 使用

```bash
paseo plugin install /absolute/path/to/conversation-view
paseo plugin ls conversation-view
```

安装后直接打开原来的 Agent 对话。更新源码后运行 `paseo plugin reload conversation-view`；不需要重启 daemon。此前独立面板的 `/reader` 入口已移除。

桌面与浏览器中，提问滚出视口后，顶部固定当前正在阅读那一轮的提问。滚动进入下一轮时切换，回滚时恢复前一轮；提问仍可见时隐藏吸顶条，滚到最底部则保留当前提问。吸顶条与正文等宽，长提问显示两行。吸顶不替换用户消息、输入框或现有回答按钮。

## 兼容边界

目标 SDK 为已发布的 0.10.3。插件仅改变客户端呈现，不启动后端进程。界面使用宿主主题与 React Native 组件。

同一时间线条目只有第一个接管的 transformer 生效。当前已安装的 `compact-agent-activity` 排在本插件之前，因此由它继续处理思考和工具聚合；本插件的对应 renderer 在没有先行接管者时生效。不自动修改其他插件。

公开 SDK 的转换会替换条目类型。助手回答转换后，原生完成 footer 的计时和分叉操作可能不再出现；插件自带复制回答。用户消息保持原生呈现。

0.10.3 没有公开的对话浮层接口。吸顶通过 `client/web.ts` 装饰现有滚动区，使用原生行标识与公开时间线读取接口匹配轮次；不依赖未发布 SDK，也不修改 daemon。它仅支持桌面与浏览器，原生 iOS / Android 暂无吸顶。宿主 DOM 标识变化时需要调整插件。对话中至少一次挂载本插件回答后才会启用吸顶；全部回答由其他 renderer 接管的对话暂不启用。

## 实现参考

- [paseo-plugin-mermaid](https://github.com/dutchakdev/paseo-plugin-mermaid)：原生 transformer / renderer、纯同步转换、未闭合代码围栏处理、稳定 source identity。
- [beautiful-chat](https://github.com/ABorakati/beautiful-chat)：直接增强原生消息、思考与工具；参考其 DOM 增强方式，在原生滚动区增加吸顶。
- [paseo-advanced-markdown](https://github.com/custyhs/paseo-advanced-markdown)：选择性接管内容与成熟 Markdown 引擎预打包。
- [paseo-markdown-viewer](https://github.com/opsb/paseo-markdown-viewer)：文件阅读与文件变更跟随，属于侧栏文件工作流，未作为新聊天页面引入。

## 验证

```bash
npm ci
npm run build:markdown
npm run typecheck
```

Markdown 引擎预打包在 `client/generated/`，稳定节点 key 与 Hermes 语法处理参考 advanced-markdown；生成文件附有完整依赖许可证。修改依赖后重新生成，不直接编辑生成文件。

软件包当前仅用于本地安装，未发布 npm。真实 iOS / Android 的长消息与滚动性能仍需验证。
