# Paseo 一线捕手离线包 — AI Agent 自动部署指南

本文档专为 AI 编码 agent（Claude Code、Codex、OpenCode 等）设计，agent 可逐条执行以下命令，自动完成 Paseo 离线包的部署和验证。

> **注意**：离线包 CLI 命名为 `paseo-tunnel`，使用 `~/.paseo-tunnel` 作为数据目录，监听端口 6768，避免与官方 Paseo 版本冲突。

## 前置条件

- **Node.js 18+** 已安装且在 `$PATH` 中
- **操作系统**: Linux (x64) 或 macOS (arm64/x64)
- **安装包**: `paseo-server-<version>-<platform>-<arch>.tar.gz`（位于当前目录）

## 第 1 步：解压并安装

```bash
# 查找当前目录下的 tarball
TARBALL=$(ls paseo-server-*.tar.gz 2>/dev/null | head -1)
if [ -z "$TARBALL" ]; then
  echo "错误：当前目录未找到 paseo-server tarball"
  exit 1
fi

# 解压
tar xzf "$TARBALL"

# 全局安装
cd package && npm install -g . && cd ..

# 验证 CLI 可用
which paseo-tunnel
paseo-tunnel --version
```

**验证**：`which paseo-tunnel` 返回路径，`paseo-tunnel --version` 退出码为 0。

## 第 2 步：启动 Daemon

```bash
# 前台模式启动（运行 5 秒后验证）
paseo-tunnel daemon start --web-ui --port 6768 --foreground &
DAEMON_PID=$!

# 等待启动
sleep 3

# 检查 daemon 是否在运行
kill -0 $DAEMON_PID 2>/dev/null
if [ $? -ne 0 ]; then
  echo "错误：Daemon 启动失败"
  exit 1
fi
```

**验证**：进程正在运行，端口 6768 已监听。

## 第 3 步：验证 Daemon 状态

```bash
# 通过 CLI 查看 daemon 状态
paseo-tunnel daemon status
```

**预期输出**包含：
- `Local Daemon: running`（绿色）
- `Home: /root/.paseo-tunnel`（或 `~/.paseo-tunnel`）
- `Listen: ws://127.0.0.1:6768`
- `PID: <数字>`

## 第 4 步：验证 Web UI

```bash
# 检查 web UI 是否正常响应
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:6768/
```

**预期**：HTTP 200。

## 第 5 步：验证健康检查接口

```bash
# 检查健康 API
curl -s http://127.0.0.1:6768/api/health
```

**预期**：`{"status":"ok","timestamp":"..."}`

## 第 6 步：验证 Agent 发现

```bash
# 查看可用的 code agent
paseo-tunnel daemon status | grep -E "Claude|Codex|OpenCode"
```

**预期**：显示已安装的 agent 及其路径。如果宿主机上安装了 agent，应显示为 `available (daemon)` 或包含路径信息。

## 第 7 步：停止 Daemon（清理）

```bash
paseo-tunnel daemon stop
sleep 1

# 验证已停止
paseo-tunnel daemon status | grep "Local Daemon"
```

**预期**：`Local Daemon: stopped`

## 第 8 步：后台模式启动（生产环境）

```bash
# 后台启动（自动守护进程化）
paseo-tunnel daemon start --web-ui --port 6768

# 验证
sleep 2
paseo-tunnel daemon status | grep "Local Daemon"
```

**预期**：`Local Daemon: running`

## 第 9 步：启用 Relay（远程访问）

如果这是远程服务器，需要从 Paseo 手机 App 访问：

```bash
# 先停止已有 daemon
paseo-tunnel daemon stop
sleep 1

# 带 relay 启动
paseo-tunnel daemon start --web-ui --relay --port 6768

# 验证 relay 状态
sleep 2
paseo-tunnel daemon status | grep "Relay"
```

**预期**：显示 relay 端点（例如 `wss://<relay-host>`）。

## 第 10 步：配置 systemd 服务（Linux）

生产服务器建议注册为 systemd 服务：

```bash
cat > /etc/systemd/system/paseo-daemon.service << 'EOF'
[Unit]
Description=Paseo Daemon (tunnel)
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/paseo-tunnel daemon start --foreground --web-ui --relay --port 6768
Restart=always
User=paseo
Environment=PASEO_HOME=/var/lib/paseo-tunnel

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable paseo-daemon
systemctl start paseo-daemon

# 验证
systemctl status paseo-daemon
```

## 故障排查

### Daemon 启动失败

```bash
# 检查端口是否被占用
lsof -i :6768

# 检查 Node.js 版本
node --version  # 必须 18+

# 查看日志
cat ~/.paseo-tunnel/logs/*.log 2>/dev/null || echo "暂无日志"
```

### Agent 未找到

```bash
# 确认 agent 在 PATH 中
which claude
which codex
which opencode

# 检查 PATH
echo $PATH
```

### 端口冲突

```bash
# 使用其他端口
paseo-tunnel daemon start --web-ui --port 6789 --foreground
```

## 验证清单

| 检查项 | 命令 | 预期结果 |
|--------|------|----------|
| CLI 已安装 | `which paseo-tunnel` | 返回 paseo-tunnel 路径 |
| Daemon 运行中 | `paseo-tunnel daemon status` | `Local Daemon: running` |
| Web UI | `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:6768/` | `200` |
| 健康检查 | `curl -s http://127.0.0.1:6768/api/health` | `{"status":"ok",...}` |
| 数据目录 | `paseo-tunnel daemon status` | `Home: .../.paseo-tunnel` |
| Agent 发现 | `paseo-tunnel daemon status` | 列出可用 agent |
| Relay（如启用） | `paseo-tunnel daemon status` | 显示 relay 端点 |
