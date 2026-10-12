<div align="center">
  <img src=".github/assets/logo.png" width="96" height="96" alt="MultiZen" />

  <h1>MultiZen</h1>

  <p><strong>面向 AI 智能体与人类操作者的浏览器配置库。</strong></p>

  <p>
    本地 Chromium 配置，各自拥有独立的 Cookie、指纹与代理。<br/>
    通过 MCP 从 Cursor、Claude Desktop 或任意 MCP 客户端驱动。
  </p>

  <p>
    <a href="https://github.com/multizenteam/multizen-browser/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/multizenteam/multizen-browser?style=for-the-badge&color=8b5cf6&labelColor=0a0b0f"></a>
    <a href="https://github.com/multizenteam/multizen-browser/blob/master/LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/multizenteam/multizen-browser?style=for-the-badge&color=ec4899&labelColor=0a0b0f"></a>
    <a href="https://github.com/multizenteam/multizen-browser/actions/workflows/release.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/multizenteam/multizen-browser/release.yml?style=for-the-badge&labelColor=0a0b0f"></a>
    <a href="https://github.com/multizenteam/multizen-browser/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/multizenteam/multizen-browser/total?style=for-the-badge&color=3b82f6&labelColor=0a0b0f"></a>
    <a href="https://github.com/multizenteam/multizen-browser/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/multizenteam/multizen-browser?style=for-the-badge&color=ff6b35&labelColor=0a0b0f"></a>
    <a href="https://discord.gg/pd6MhzPbJ3"><img alt="Discord" src="https://img.shields.io/badge/discord-join-5865f2?style=for-the-badge&labelColor=0a0b0f"></a>
  </p>

  <p>
    <strong>简体中文</strong>
    &nbsp;·&nbsp;
    <a href="./README.en.md">English</a>
    &nbsp;·&nbsp;
    <a href="https://getmultizen.com"><strong>getmultizen.com</strong></a>
    &nbsp;·&nbsp;
    <a href="https://github.com/multizenteam/multizen-browser/releases/latest">下载</a>
    &nbsp;·&nbsp;
    <a href="https://discord.gg/pd6MhzPbJ3">Discord</a>
  </p>

  <br/>

  <img src=".github/assets/profiles-list.jpg" alt="MultiZen 配置库界面：显示平台、代理国家与 AI 活动指标" width="100%" />

  <br/><br/>
</div>

## 这是什么

MultiZen 是一个桌面应用，管理一整套相互隔离的 Chromium 浏览器配置。每个配置都有自己独立的 Cookie、登录态、指纹和代理。本地 MCP 服务器（`127.0.0.1:7777`）把浏览器驱动工具（导航、点击、输入、提取、截图、执行 JS、Cookie、标签页、等待）暴露给任何 MCP 客户端。

结果是：Cursor 或 Claude Desktop 里的 AI 智能体可以完成真实的、带登录态的工作流。Cookie 与会话状态在多次启动之间保留，登录信息和上下文可以跨 AI 会话延续。

MultiZen 还支持横向扩展：运行多个相互隔离的应用实例，或同一配置的多个浏览器——每个活跃浏览器都有自己的 MCP 端点，多个智能体可以并行地各自驱动自己的浏览器（参见[并行智能体](#并行智能体实例与按实例端点)）。

## 安装

### macOS

最省事的路径，Homebrew 会替你处理 Gatekeeper 隔离：

```sh
brew tap multizenteam/multizen
brew install --cask multizen
```

也可以直接从 [releases 页面](https://github.com/multizenteam/multizen-browser/releases/latest)下载 DMG，安装后执行一次以下命令以绕过未签名应用的警告：

```sh
xattr -cr /Applications/MultiZen.app
```

### Linux

```sh
curl -LO https://github.com/multizenteam/multizen-browser/releases/latest/download/MultiZen-linux-x86_64.AppImage
chmod +x MultiZen-linux-x86_64.AppImage
./MultiZen-linux-x86_64.AppImage
```

部分发行版需要 `libfuse2`（Ubuntu 24.04+ 上执行 `apt install libfuse2t64`）。如果 Chromium 沙箱拒绝启动，加上 `--no-sandbox`。

### Windows

下载 [MultiZen-win-x64.exe](https://github.com/multizenteam/multizen-browser/releases/latest/download/MultiZen-win-x64.exe)。首次下载时 SmartScreen 可能将安装程序标记为无法识别。点击**更多信息**，然后选择**仍要运行**。

### 一键安装脚本

macOS 与 Linux：

```sh
curl -sSL https://getmultizen.com/install.sh | bash
```

## 工作原理

```
+----------------------+         +-----------------------+
|  Cursor / Claude     |  MCP    |  MultiZen Desktop App |
|  Desktop / Cline     | <-----> |  127.0.0.1:7777       |
+----------------------+         +-----------+-----------+
                                             |
                                             | spawn / drive (CDP)
                                             v
                              +--------------+--------------+
                              |  Profile A  |  Profile B  | ...
                              |  cookies    |  cookies    |
                              |  proxy LU   |  proxy US   |
                              |  Win 145    |  macOS 145  |
                              +-------------+--------------+
                                            |
                                            v
                                  patched Chromium binary
                                  (canvas, WebGL, audio,
                                   font, WebRTC fingerprints
                                   spoofed at C++ level)
```

每个配置都是一个真实的 Chromium 窗口，状态持久化在磁盘上。MCP 服务器通过标准的 Model Context Protocol Streamable HTTP 传输（外加旧版 SSE）对外服务，因此兼容任何客户端。浏览器驱动工具底层调用 Chrome DevTools Protocol。

## 功能特性

| | 作用 |
| --- | --- |
| **MCP 服务器** | 原生本地端点。兼容 Cursor、Claude Desktop、Cline、Continue 以及任何支持 MCP 的客户端。 |
| **反检测 Chromium** | 源码级补丁的浏览器引擎（CloakBrowser）。Canvas、WebGL、音频、字体、WebRTC IP 全部在 C++ 层伪装，而非 JS 注入。 |
| **持久化状态** | Cookie、登录态、IndexedDB、localStorage 按配置隔离，跨启动、跨 AI 会话保留。 |
| **并行智能体** | 运行多个命名应用实例（`--instance-id`，数据相互隔离），或同一配置的多个浏览器。每个活跃的浏览器实例都暴露自己的 MCP 端点（端口 + 令牌），供专属智能体使用。 |
| **临时配置（Ephemeral）** | 将配置标记为临时：每次启动都会物化一个一次性工作副本（复制身份与 Cookie，跳过缓存），关闭时直接删除、绝不回写——模板始终保持纯净。 |
| **干净启动** | 每个浏览器只打开一个标签页：该配置的启动页。运行之间不恢复标签页；登录态与存储照常保留。 |
| **跨平台人设** | 在 Mac 主机上运行 Windows 人设（或反之）。C++ 补丁保证 V8、Blink 与 CSS 特性签名的指纹一致性。 |
| **代理与人设对齐** | 每配置 HTTP 或 SOCKS5 代理，配合本地 SOCKS5 桥让 DNS 解析也留在远端。时区、语言环境、`navigator.geolocation` 自动对齐代理出口 IP。 |
| **自托管** | 配置以纯 SQLite + Chromium user-data-dir 格式存放在你的磁盘上。无账号、无授权服务器、无遥测。 |
| **开源** | 应用、MCP 服务器与 CDP 驱动全部 MIT 许可。补丁版 Chromium 引擎同样开源。 |

## 首次运行

<div align="center">
  <img src=".github/assets/firstrun.jpg" alt="MultiZen 首次运行引导" width="85%" />
</div>

## 连接智能体（Codex、Cursor、Claude Desktop）

安装后，MCP 服务器在 `127.0.0.1:7777` 启动。它在 `http://127.0.0.1:7777/mcp` 提供当前标准的 **Streamable HTTP** 传输（并为旧客户端保留 HTTP+SSE 端点 `/sse`）。

服务器要求 **Bearer 令牌**——首次运行时生成，显示在应用的 **MCP → 连接智能体** 面板下（同时写入应用数据目录中的 `mcp-token` 文件）。下方每个客户端配置都必须以 `Authorization: Bearer <token>` 的形式发送它，请把 `<token>` 换成你自己的。应用的 MCP 面板提供**复制给 LLM**按钮，可以把整套配置（含令牌）直接交给编码智能体，免去手动编辑配置文件。

**Codex CLI**（`~/.codex/config.toml`）——直连 Streamable HTTP：

```toml
[mcp_servers.multizen]
url = "http://127.0.0.1:7777/mcp"
http_headers = { Authorization = "Bearer <token>" }
```

**JSON URL 客户端——Cursor**（`~/.cursor/mcp.json`）、Cline、Continue：

```json
{
  "mcpServers": {
    "multizen": {
      "url": "http://127.0.0.1:7777/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

**Claude Desktop**（macOS 上位于 `~/Library/Application Support/Claude/claude_desktop_config.json`）——它的配置没有 `url` 字段，因此需要通过 [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) 桥接该端点（需要 Node）：

```json
{
  "mcpServers": {
    "multizen": {
      "command": "npx",
      "args": ["mcp-remote", "http://127.0.0.1:7777/mcp", "--header", "Authorization: Bearer <token>"]
    }
  }
}
```

重启客户端。此后智能体拥有完整的工具集——配置（`list_profiles`、`create_profile`、`update_profile`、`delete_profile`、`launch_profile`、`close_profile`）、实例（`list_runs`、`close_run`）、页面驱动（`navigate`、`click`、`type`、`extract`、`screenshot`、`evaluate_js`）、标签页（`list_tabs`、`new_tab`、`activate_tab`、`close_tab`）、Cookie（`get_cookies`、`set_cookies`）、等待（`wait_for_load`、`wait_for_navigation`、`wait_for_selector`）、指纹（`list_fingerprint_options`），以及原始 `cdp_send`。

## 并行智能体：实例与按实例端点

两个层面的并行，全部在本地完成。

### 命名应用实例

多次启动应用，每个实例拥有自己的配置数据库、设置和 MCP 令牌——共享同一份引擎下载：

```sh
MultiZen.exe --instance-id=A --mcp-port=12001 --data-dir="D:\MultiZenData"
MultiZen.exe --instance-id=B --mcp-port=12002 --data-dir="D:\MultiZenData" --launch-profile=Work
```

| 参数 | 作用 |
| --- | --- |
| `--instance-id=<id>` | 以命名实例运行（显示在窗口标题与 MCP 面板）。同一 id 重复启动会被拒绝，并聚焦到已有窗口。 |
| `--data-dir=<path>` | 实例数据根目录。带 id 时：`<path>/<id>`；单独使用：路径本身；只有 id 时：`<userData>/instances/<id>`。 |
| `--mcp-port=<n>` | 本实例的 MCP 端口。优先级：CLI > `MULTIZEN_MCP_PORT` > 设置 > 7777。显式指定的端口被占用时会明确报错，而不是静默地在没有 MCP 的情况下启动。 |
| `--launch-profile=<id\|name>` | MCP 服务器就绪后自动启动该配置——智能体可以立即连接，无需在 GUI 中手动点击。 |
| `--import-profile=<file.mzar>` | 启动时导入加密配置归档（`--import-passphrase` 提供口令）；配合 `--launch-profile` 可实现脚本化拉起。 |
| `--window=<mode>` | `cascade`、`tile-left`、`tile-right` 或 `quad-1..4` 窗口摆放——始终位于主显示器工作区内，不会跑出屏幕。 |

### 同一配置的多个浏览器（运行实例）

配置卡片的**新实例**按钮（或启动一个已在运行的配置）会开启同一配置的另一个浏览器。

每个实例——包括第一个——都在配置数据的一个私有**工作副本**上执行，因此并行实例之间互不影响，活跃的浏览器也永远不会把配置目录锁住。当实例的浏览器退出时，其身份数据的变更会合并回配置目录：Cookie 按行级合并（兄弟实例的结果彼此收敛，登出操作也会传播），最后退出的实例还会把其余身份数据（LocalStorage、IndexedDB、密码、偏好设置、扩展）一并回写。如果应用本身在运行中途崩溃，遗留的工作副本会在下次启动时被检测并合并。

每个活跃实例都拥有自己的 **MCP 端点**——独立的端口与 Bearer 令牌：

- 管理端点上的 `list_runs` 返回每个实例的 URL 与令牌（应用的 MCP 面板显示同样的列表，并附复制按钮）；
- 把智能体指向某个实例的端点，所有浏览器工具都精确作用于那个浏览器——无歧义、不共享；
- 在管理端点上，带 `profile_id` 的调用仅在该配置恰好只有一个活跃实例时有效——存在多个实例时调用会被拒绝，并提示你改用按实例端点；
- `close_run` 按 id 停止一个实例，其余兄弟实例继续运行。

### 临时配置（Ephemeral）

在配置编辑器中标记为**临时**（或通过 `update_profile` 传 `ephemeral: true`）：每次启动都会从模板物化一个全新的工作副本——含身份、Cookie 与指纹——浏览器关闭时副本直接删除，**不回写任何数据**。适合模板必须保持纯净的并行一次性任务。（普通配置同样运行在工作副本上，只是退出时会合并回变更。）

### 干净启动

每次启动只打开一个标签页：该配置的启动页（默认 DuckDuckGo——可设为 `about:blank` 得到空白窗口）。上一次运行的标签页绝不恢复，崩溃后出现的「恢复页面？」气泡也被抑制。Cookie、登录态与存储仍按配置跨运行保留。

### 浏览器窗口

在 **设置 → 浏览器窗口** 中选择打开屏幕：主屏幕、最左侧、最右侧，或跟随 MultiZen 所在屏幕；还可以开启“启动时最大化”。修改自动保存，下一次启动浏览器时生效（界面与 MCP 启动均适用）。默认使用主屏幕、普通窗口居中打开；单屏时所有选项均使用该屏幕，屏幕位置按系统显示设置中的排列判断。每个命名应用实例保存自己的设置。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面外壳 | Electron 33 |
| 渲染进程 | React 19、Tailwind v4、TypeScript strict |
| 主进程 | TypeScript ESM、electron-vite、原生 MCP SDK |
| MCP 服务器 | `@modelcontextprotocol/sdk`，Streamable HTTP + SSE |
| 配置存储 | better-sqlite3，幂等迁移 |
| 浏览器驱动 | chrome-remote-interface（CDP） |
| 浏览器引擎 | CloakBrowser（开源补丁版 Chromium） |
| 构建 | Yarn 4 workspaces、electron-vite、electron-builder |
| CI | GitHub Actions，macOS / Windows / Linux 矩阵 |

## 开发

```sh
git clone https://github.com/multizenteam/multizen-browser
cd multizen-browser
yarn install
yarn dev            # 以开发模式启动桌面应用
yarn mcp:dev        # 独立运行 MCP 服务器用于测试
yarn typecheck      # 全部 workspace 的严格 TS 检查
yarn build          # 完整发布构建（mac/win/linux 按当前 OS）
```

需要 Node 22+ 与 Yarn 4（通过 Corepack）。

## 仓库结构

```
apps/
  desktop/                Electron + React + Tailwind GUI + 主进程
packages/
  mcp-server/             提供浏览器驱动工具的 MCP 服务器
  cdp-driver/             chrome-remote-interface 的轻封装
  profile-manager/        SQLite 配置 CRUD + 加密本地存储
  settings-store/         应用级设置持久化
  types/                  共享 TypeScript 类型
.github/
  workflows/release.yml   矩阵构建，tag 触发
```

## 路线图

未来版本中计划落地的内容。

- **行为注入**：在 CDP 输入层应用拟人化鼠标轨迹、击键节奏与滚动抖动。
- **按配置云同步**（可选、端到端加密）：让同一配置跨设备跟随你。
- **团队工作区**：带审计日志的共享配置池。

## 为什么选 MultiZen

| | MultiZen | Browserbase / Hyperbrowser | GoLogin / AdsPower / Multilogin |
| --- | :---: | :---: | :---: |
| 原生 MCP 服务器 | ✓ | ✓ | 仅配置 CRUD |
| 通过 MCP 驱动浏览器 | ✓ | ✓ | ✗ |
| C++ 层反检测 | ✓ | 部分 | ✓ |
| 跨会话持久登录 | ✓ | 按会话 | ✓ |
| 自托管 | ✓ | ✗ | ✗ |
| 面向操作者的手动 GUI | ✓ | ✗ | ✓ |
| 按浏览器小时计费 | 否 | 是 | 视情况 |
| 开源核心 | ✓ | 仅 SDK | ✗ |

## 合理使用

构建多账号浏览器是双刃剑。我们支持跨角色跨地区的 QA 测试、你被授权执行的代理运营工作流、市场调研、多市场电商运营、AI 驱动的销售工程，以及你合法拥有的个人账号。我们不支持违反平台条款、批量养号、规避封禁或欺诈行为。完整政策见 [getmultizen.com/acceptable-use](https://getmultizen.com/acceptable-use)。

## 许可证

[MIT](LICENSE)。随意使用。

<div align="center">
  <br/>
  <sub>
    Built in transit by <a href="https://github.com/oboshto">@oboshto</a>.<br/>
    如果 MultiZen 对你有用，请给这个仓库点个 Star，这对我们帮助很大。
  </sub>
</div>
