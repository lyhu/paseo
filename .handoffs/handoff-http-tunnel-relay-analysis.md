# Handoff — Paseo 内外网 HTTP 代理（中继隧道）方案分析与设计

- 日期: 2026-08-15
- 项目: /Users/lyhu/project/paseo
- 状态: 分析/设计阶段（纯咨询，无代码改动，git 工作树干净）

## 1. 任务背景与目标

用户想让 Paseo 的加密中继（relay）实现"内外网 HTTP 代理"，具体场景：

- 内网部署 OpenAI 协议大模型 API（如 `http://10.0.0.5:8000/v1/...`，含 SSE 流式、可能的 WebSocket Realtime）
- 外网 daemon 暴露兼容 HTTP API 供 AI 应用调用
- 中继只转发、不解析内容

目标产出：可行性分析 + 详细实现方案（架构、连接流程、HTTP/SSE/WebSocket 透传、错误/重连、安全、复用点与新增点）。随后用户追问"如果做成类 Nginx 的通用 HTTP 反向代理，复杂度与可行性如何"。

## 2. 已完成的结论（摘要）

### 2.1 可行性与核心思路

- 中继"只转发不解析"是优势而非障碍：`RelayDurableObject` 只读 query 参数与 WebSocket attachment 元数据（serverId/role/v/connectionId），消息体原样转发，天然适配 HTTP/SSE（字节流）与 WebSocket（双向帧）。
- 关键约束：中继只接受 `GET /ws` 的 WebSocket Upgrade（非 upgrade 返回 426），**没有普通 HTTP 入口**。因此纯 HTTP/SSE 必须**复用 WebSocket 作为传输隧道**，在隧道内封装 HTTP 字节。
- 两端 daemon 都**出站**连接中继（NAT 友好）：内网 daemon 走现有 `startRelayTransport` 的 server 角色；外网 daemon 作为 client 角色。中继只配对转发。
- 首选封装方案：**HTTP-over-WebSocket 多路复用（streamId + 长度前缀帧）**，备选：每请求一条数据 socket（原型快但并发开销大）。
- 数据流：AI 应用 → 外网 daemon(egress) → 中继 → 内网 daemon(ingress) → LLM API，SSE 按 chunk 逐帧透传、不聚合。

### 2.2 类 Nginx 通用反向代理（第二轮分析）

- 可行性分阶段：阶段 1 专用 OpenAI 隧道（低复杂度，直接落地）；阶段 2 通用 HTTP/1.1 反向代理（路由引擎 + SSRF 授权表是主要增量，可行可控）；阶段 3 HTTP/2/gRPC/TLS 终止等 Nginx 全能力（投入产出比低，不建议自研）。
- 关键架构洞察：**隧道与代理解耦**——隧道层只做打通（NAT 穿透 + E2EE + 配对 + 鉴权 + allowlist），通用 HTTP 能力（HTTP/2、TLS、限流、缓存、负载均衡）交给两侧已有的 Nginx/Caddy。不要在中继上复刻 Nginx。

### 2.3 安全要点

- E2EE（X25519 + tweetnacl secretbox）由现有 `EncryptedChannel` 提供，中继只见密文，兼作双向身份认证。
- 中继级访问控制待补：现有中继不认证谁能用某 `serverId` 挂载 → 用高熵 serverId（HMAC 派生）或 `/ws` 增加每 serverId 鉴权 token（只比对参数，不解析内容）。
- 外层：egress 对 AI 应用要求 Bearer API key。
- ingress 防 SSRF：只允许转发到配置的 base URL（host+路径 allowlist），否则退化成内网开放代理。
- 隧道连接用 `tun_` 前缀 connectionId 与 agent RPC 连接隔离。

## 3. 关键代码事实（供接续者参考）

### 中继 packages/relay

- `src/cloudflare-adapter.ts` — `RelayDurableObject`：v1/v2 协议路由（`role=server` 控制 socket、`role=server+connectionId` 数据 socket、`role=client+connectionId` 客户端 socket）、`bufferFrame` 上限 200 帧、`notifyControls({type:"connected"|"disconnected"|"sync"})`、半开检测 `nudgeOrResetControlForConnection`。**中继不解析 payload**。
- `src/crypto.ts` — X25519 派生 + secretbox 加解密（纯 JS tweetnacl，性能瓶颈点）。
- `src/encrypted-channel.ts` — `EncryptedChannel` / `createClientChannel` / `createDaemonChannel`，支持 string/ArrayBuffer 帧与二进制密文。
- `src/cutover-proxy.ts` + `PASEO_RELAY_UPSTREAM` — 切流代理（Cloudflare 转发到 Fly.io Node relay），非核心路径。
- 部署：wrangler，Durable Object 每 serverId 一个实例。

### daemon packages/server

- `src/server/relay-transport.ts` — `startRelayTransport`（daemon 以 server 角色拨号中继，控制 socket + per-connection 数据 socket）。`relay-transport` 中 `RELAY_WEBSOCKET_OPTIONS` 设 `perMessageDeflate: false`。
- `src/server/relay-runtime.ts` — 中继传输生命周期。
- `src/server/websocket/encrypted-relay-socket.ts` — 把 EncryptedChannel 包装成 WebSocket-like socket 挂进 daemon 的 WebSocket server。
- `src/server/service-proxy.ts` — **现有 HTTP 反向代理骨架**（高价值复用点）：`stripHopByHopHeaders`、`buildForwardedHeaders`、`proxyHttpRequest`（流式 req→proxyReq、proxyRes→res）、`proxyUpgradeRequest`（WebSocket 裸 socket pipe）、`ServiceProxyRouteRegistry`（hostname→port，仅前缀/后缀匹配）、`startStandalone`。注意：每请求新连、仅 localhost 单后端。
- `src/server/bootstrap.ts` — daemon 装配入口（服务代理的挂载位置）。
- `src/server/websocket-server.ts` — 接受直连与中继 client 连接的 WebSocket server。

### 协议 packages/protocol

- `src/daemon-endpoints.ts` — `buildRelayWebSocketUrl` 等中继 URL 构造，egress 侧可用。

## 4. 建议的下一步（按优先级）

1. 阶段 1 落地：设计隧道帧协议字节格式 + TypeScript 类型（`REQUEST_HEAD/REQUEST_BODY/RESPONSE_HEAD/RESPONSE_BODY/END/CANCEL/PING` + streamId + 长度前缀）。
2. 起草 `tunnel-client.ts`（egress）/ `tunnel-server.ts`（ingress）骨架，基于 `service-proxy.ts` 泛化上游目标（`127.0.0.1:port` → 隧道流）。
3. 补齐安全：中继 serverId 级鉴权、ingress 上游 allowlist schema（走现有 Zod + 文件持久化体系，见 docs/data-model.md）。
4. 若用户确认，将方案整理成 `docs/http-tunnel.md` 并在 AGENTS.md 目录表登记（遵循 docs 编写规范：整合不附加、不记录逻辑）。
5. 阶段 2（通用 HTTP/1.1 反代）仅在阶段 1 验证后考虑；阶段 3 明确不做，用成熟反代（Nginx/Caddy）承担。

## 5. 注意事项 / 项目规则（接续者必须遵守）

- 本仓库 docs/ 是系统知识唯一来源，动手前先看相关 doc（架构、service-proxy、data-model、security、protocol-compatibility）。
- 改代码后必须 `npm run typecheck`、`npm run lint`、`npm run format`；跨包类型错误先重建依赖栈（`npm run build:client` / `build:server`）。
- 只跑改动的测试文件：`npx vitest run <file> --bail=1`；绝不跑全量测试。
- 协议变更须读 docs/protocol-compatibility.md：向后兼容、wire schema 纯净（无 transform/catch/preprocess）。
- 不可靠推断时间/超时就重启 6767 端口主 daemon（会杀掉 agent 进程）。
- 不把本对话中任何凭据写入文档/代码（本对话未涉及凭据，记忆中的任何 token 也不得写入交付物）。

## 6. Suggested skills

- `lsp-code-analysis` — 深入定位/复用 service-proxy.ts、relay-transport.ts 等符号时做语义导航。
- `codebase-design` — 设计隧道帧协议与 tunnel client/server 模块接口时使用其"深模块"词汇与接口设计方法。
- `domain-modeling` — 为隧道、egress/ingress、connectionId 等术语建立一致的项目词汇。
- `tdd` — 若进入实现阶段，隧道帧协议的编码/解码建议测试先行。
- `research` — 若需核实 OpenAI SSE/Realtime WS 协议细节或 Cloudflare Durable Object 限制时抓取一手资料。
