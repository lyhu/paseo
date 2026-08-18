# Paseo Offline Server — 使用说明

## 系统要求

- **Node.js** 18.0 或更高版本
- **操作系统**: Linux (x64) 或 macOS (arm64/x64)
- **磁盘空间**: 解压后约 500 MB

## 安装

```bash
# 解压
tar xzf paseo-server-0.4.0-darwin-arm64.tar.gz

# 全局安装
cd package && npm install -g .

# 验证安装
paseo --version
```

## 启动

### 本地开发（仅 web UI）

```bash
paseo daemon start --web-ui --port 6768 --foreground
```

浏览器打开 http://127.0.0.1:6768

### 远程服务器（带 relay，供手机 App 连接）

```bash
paseo daemon start --web-ui --relay --port 6768 --foreground
```

### 后台运行

```bash
paseo daemon start --web-ui --relay --port 6768
```

查看状态:

```bash
paseo daemon status
```

停止:

```bash
paseo daemon stop
```

## 数据目录

离线包自动使用 `~/.paseo-tunnel` 作为数据目录（`PASEO_HOME`），与官方版本的 `~/.paseo` 完全隔离。配置、agent 状态、日志等数据各自独立。

### 自定义数据目录

```bash
export PASEO_HOME=/path/to/data
paseo daemon start --web-ui --port 6768
```

### 设置访问密码

```bash
export PASEO_PASSWORD=your-secure-password
paseo daemon start --web-ui --relay --port 6768
```

## 使用 code agent

确保目标 agent CLI 已安装在宿主机上:

```bash
# 验证 agent 可用
which claude    # Claude Code
which codex     # Codex
which opencode  # OpenCode
```

Daemon 会自动发现 `$PATH` 中的 agent。

## 连接手机 App

1. 在服务器上启动 daemon（带 `--relay` 参数）
2. 打开 Paseo App
3. 添加远程连接，使用 relay 地址
4. 输入 daemon 密码（如已设置）

## 升级

```bash
# 下载新版本 tarball
tar xzf paseo-server-0.5.0-linux-x64.tar.gz
cd package && npm install -g .
paseo daemon stop && paseo daemon start --web-ui --relay --port 6768
```

## 常见问题

### 端口冲突

如果 6768 被占用，使用其他端口:

```bash
paseo daemon start --web-ui --port 6789
```

### 无法发现 agent

确保 agent CLI 在 `$PATH` 中:

```bash
echo $PATH
which claude
```

### 日志查看

```bash
# 前台运行时日志直接输出到终端
# 后台运行时日志在 PASEO_HOME 目录下
tail -f ~/.paseo/logs/*.log
```
