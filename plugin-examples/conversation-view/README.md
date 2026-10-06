# Paseo Conversation View · 吸顶提问

在 Paseo 原生对话中固定显示当前阅读轮次的提问。插件保留原生回答、思考、工具记录、复制和分叉操作，不替换时间线条目。

## 使用

```bash
paseo plugin install /absolute/path/to/conversation-view
paseo plugin ls conversation-view
```

安装后打开原来的 Agent 对话。更新源码后运行 `paseo plugin reload conversation-view`；不需要重启 daemon。

输入区的「吸顶提问」默认开启，点击可关闭或重新开启。吸顶通过这个开关的生命周期接入，不再依赖助手回答渲染。

提问滚出视口后，顶部固定当前正在阅读那一轮的提问。进入下一轮时切换，回滚时恢复前一轮；提问仍可见时隐藏吸顶条，滚到最底部则保留当前提问。

吸顶条与正文等宽，继承原生用户消息的背景、圆角、内边距和字体。默认显示最多六行，超过才显示「更多…」；展开后可阅读全文并「收起」，过长内容在提问区域内滚动。切换提问时恢复折叠。

## 兼容边界

目标 SDK 为已发布的 0.10.3。插件仅改变客户端呈现，不启动后端进程，也不修改其他插件。

0.10.3 没有公开的对话浮层接口。吸顶通过 `client/web.ts` 装饰现有滚动区，使用原生行标识与公开时间线读取接口匹配轮次；不依赖未发布 SDK，也不修改 daemon。当前仅支持桌面与浏览器，原生 iOS / Android 暂无吸顶。宿主 DOM 标识变化时需要调整插件。

未挂载输入区开关的归档只读窗口暂不显示吸顶。

## 实现参考

[beautiful-chat](https://github.com/ABorakati/beautiful-chat)：参考其 DOM 增强方式，在原生滚动区增加吸顶。

## 验证

```bash
npm ci
npm run typecheck
```

软件包当前仅用于本地安装，未发布 npm。
