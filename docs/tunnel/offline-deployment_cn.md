# 一线捕手离线部署包

## 概述

一线捕手离线部署包是一个自包含的 Paseo daemon 发行版，专为远程编码和团队协作场景设计。它将 daemon、CLI 和 web UI 打包为一个 tarball，开箱即用，无需 Docker，无需额外配置。

## 适用场景

### 远程服务器编码

在云服务器或物理机上安装离线包，daemon 直接运行在宿主机上，能自动发现已安装的 Claude Code、Codex、OpenCode 等 AI 编码 agent。开发者通过手机 App 或浏览器远程连接，即可在服务器上执行编码任务——代码在服务器上运行，agent 直接操作服务器文件系统。

### 本地工作站开发

在个人电脑上安装同样的离线包，通过 `--web-ui` 启动后，浏览器打开 `http://127.0.0.1:6768` 即可使用完整的 Paseo 界面进行开发。无需安装手机 App，适合习惯在浏览器中工作的开发者。

### 团队协作

团队成员各自在本地或远程机器上部署离线包，通过 relay 互相连接。手机 App 作为移动端入口，随时随地查看 agent 状态、发起编码任务。

## 核心优势

### 与官方 App 无缝兼容

离线包不修改 Paseo 的通信协议层（protocol、relay、client），手机 App 通过标准 WebSocket RPC 和 relay 协议连接，无法区分离线包与官方版本。手机 App 保持官方版本，自动更新，零额外维护。

### 单包通用，一处构建多处部署

Ingress（远程服务器）和 Egress（本地工作站）使用完全相同的 tarball，不需要区分"服务器版"和"桌面版"。构建一次，随处安装。

### 默认端口 6768，与官方互不冲突

官方 daemon 默认使用 6767 端口，离线包使用 6768。两者可在同一台机器上共存，互不干扰。

### 独立数据目录，互不影响

离线包自动将 `PASEO_HOME` 设为 `~/.paseo-tunnel`，与官方的 `~/.paseo` 完全隔离。配置、agent 状态、日志等数据各自独立，升级或卸载一方不会影响另一方。

### 精简体积，不含语音

剥离了 `sherpa-onnx-node` 及所有语音相关代码，包体积更小，安装更快。专注于核心的 agent 管理和远程编码能力。

### 协议兼容，升级无忧

只修改 `packages/server/` 和 `packages/cli/`，protocol、relay、client 包保持不动。拉取上游更新时合并冲突最小，升级路径清晰。

## 快速上手

```bash
# 安装（需要 Node.js 18+）
npm install -g ./paseo-server-0.4.0-linux-x64.tar.gz

# 启动 daemon（远程服务器，带 relay）
paseo daemon start --web-ui --relay --port 6768 --foreground

# 启动 daemon（本地工作站，仅 web UI）
paseo daemon start --web-ui --port 6768 --foreground

# 打开浏览器
open http://127.0.0.1:6768
```

## 包内容

```
paseo-server-<version>-<platform>-<arch>.tar.gz（压缩后约 130 MB）
  ├── package/
  │   ├── package.json              # 包装 package.json，用于 npm install -g
  │   ├── package-lock.json
  │   ├── bin/paseo               # CLI 入口
  │   ├── dist/                   # 编译后的 server 代码 + web UI
  │   │   ├── server/
  │   │   │   ├── server/         # Daemon 代码
  │   │   │   └── web-ui/        # Web UI 静态资源
  │   │   └── scripts/           # Supervisor 入口
  │   ├── cli-dist/              # 编译后的 CLI 代码
  │   ├── local-packages/        # 打包的 workspace 依赖
  │   │   ├── protocol/
  │   │   ├── client/
  │   │   ├── highlight/
  │   │   ├── relay/
  │   │   └── plugin/
  │   └── node_modules/         # 精简后的生产依赖
```

## 构建

```bash
./scripts/build-offline-package.sh
# 输出: dist-offline/paseo-server-<version>-<platform>-<arch>.tar.gz
```

## 升级流程

```
上游发布新版本 → 合并到修改分支（仅 server/ + cli/）→ 重新构建离线包
→ 服务器/工作站: npm install -g 更新并重启 daemon
→ 手机: App Store 自动更新（官方版本，无需操作）
```

## 安全

- 监听 `0.0.0.0` 时设置 `PASEO_PASSWORD` 防止未授权访问。
- daemon 遵循与官方版本相同的认证模型。
- Relay 连接使用 E2E 加密（与官方相同）。
