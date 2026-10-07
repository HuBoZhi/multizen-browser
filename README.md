<div align="center">
  <img src=".github/assets/logo.png" width="96" height="96" alt="MultiZen" />

  <h1>MultiZen</h1>

  <p><strong>A browser library for AI agents and human operators.</strong></p>

  <p>
    Local Chromium profiles with their own cookies, fingerprint, and proxy.<br/>
    Drive them through MCP from Cursor, Claude Desktop, or any MCP client.
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
    <a href="https://getmultizen.com"><strong>getmultizen.com</strong></a>
    &nbsp;·&nbsp;
    <a href="https://github.com/multizenteam/multizen-browser/releases/latest">Download</a>
    &nbsp;·&nbsp;
    <a href="https://discord.gg/pd6MhzPbJ3">Discord</a>
  </p>

  <br/>

  <img src=".github/assets/profiles-list.jpg" alt="MultiZen profile library with platform, proxy country, and AI-activity indicators" width="100%" />

  <br/><br/>
</div>

## What it is

MultiZen is a desktop app that runs a library of isolated Chromium browser profiles. Each profile has its own cookies, login state, fingerprint, and proxy. A local MCP server on `127.0.0.1:7777` exposes browser-drive tools (navigate, click, type, extract, screenshot, evaluate JS, cookies, tabs, waits) to any MCP client.

The result: your AI agent in Cursor or Claude Desktop can complete real authenticated workflows. Cookies and session state survive between launches, so logins and context carry over across AI sessions.

MultiZen also scales sideways: run several isolated app instances, or several browsers of the same profile — every live browser gets its own MCP endpoint, so multiple agents can each drive their own browser in parallel (see [Parallel agents](#parallel-agents-instances-and-per-run-endpoints)).

## Install

### macOS

The cleanest path. Homebrew handles the Gatekeeper quarantine for you:

```sh
brew tap multizenteam/multizen
brew install --cask multizen
```

Or grab the DMG straight from the [releases page](https://github.com/multizenteam/multizen-browser/releases/latest) and run this once after install to bypass the unsigned-app warning:

```sh
xattr -cr /Applications/MultiZen.app
```

### Linux

```sh
curl -LO https://github.com/multizenteam/multizen-browser/releases/latest/download/MultiZen-linux-x86_64.AppImage
chmod +x MultiZen-linux-x86_64.AppImage
./MultiZen-linux-x86_64.AppImage
```

Some distros need `libfuse2` (`apt install libfuse2t64` on Ubuntu 24.04+). If Chromium's sandbox refuses to start, add `--no-sandbox`.

### Windows

Download [MultiZen-win-x64.exe](https://github.com/multizenteam/multizen-browser/releases/latest/download/MultiZen-win-x64.exe). SmartScreen may flag the installer as unrecognized on first download. Click **More info**, then **Run anyway**.

### One-liner installer

For macOS and Linux:

```sh
curl -sSL https://getmultizen.com/install.sh | bash
```

## How it works

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

Each profile is a real Chromium window with persistent state on disk. The MCP server speaks the standard Anthropic Model Context Protocol over Streamable HTTP (plus legacy SSE) so it works with any client. Browser-drive tools call into Chrome DevTools Protocol under the hood.

## Features

|  | What it does |
| --- | --- |
| **MCP server** | Native localhost endpoint. Works with Cursor, Claude Desktop, Cline, Continue, anything else that speaks MCP. |
| **Anti-detect Chromium** | Source-patched browser engine (CloakBrowser). Canvas, WebGL, audio, fonts, WebRTC IP all spoofed at C++ level instead of JS injection. |
| **Persistent state** | Cookies, login, IndexedDB, localStorage stay per-profile across launches and across AI sessions. |
| **Parallel agents** | Run several named app instances (`--instance-id`) with isolated data, or several browsers of one profile. Every live browser run exposes its own MCP endpoint (port + token) for a dedicated agent. |
| **Ephemeral profiles** | Flag a profile as ephemeral: each launch materializes a disposable working copy (identity and cookies copied, caches skipped) that is deleted on close — the template stays pristine. |
| **Fresh launches** | Every browser opens exactly one tab: the profile's start page. No tab restore between runs; logins and storage persist as always. |
| **Cross-platform persona** | Run a Windows persona on a Mac host (or vice versa). C++ patches keep the fingerprint coherent across V8, Blink, and CSS feature signatures. |
| **Proxy + persona alignment** | Per-profile HTTP or SOCKS5 proxy with a local SOCKS5 bridge so DNS resolution stays remote. Auto-aligns timezone, locale, and `navigator.geolocation` to the proxy egress IP. |
| **Self-hosted** | Profiles live on your disk in plain SQLite plus Chromium user-data-dir format. No account, no license server, no telemetry. |
| **Open source** | MIT for the entire app, MCP server, and CDP driver. Patched Chromium engine is also open source. |

## Onboarding

<div align="center">
  <img src=".github/assets/firstrun.jpg" alt="MultiZen first-run onboarding" width="85%" />
</div>

## Connect an agent (Codex, Cursor, Claude Desktop)

After installing, the MCP server starts on `127.0.0.1:7777`. It serves the current
**Streamable HTTP** transport at `http://127.0.0.1:7777/mcp` (plus a legacy HTTP+SSE
endpoint at `/sse` for older clients).

The server requires a **bearer token** — it is generated on first run and shown in
the app under **MCP → Connect an agent** (also written to the `mcp-token` file in
the app data directory). Every client config below must send it as
`Authorization: Bearer <token>`. Replace `<token>` with your own. The app's MCP
panel has a **Copy for LLM** button that hands the whole setup (token included) to
a coding agent if you'd rather not edit config files by hand.

**Codex CLI** (`~/.codex/config.toml`) — connects to Streamable HTTP directly:

```toml
[mcp_servers.multizen]
url = "http://127.0.0.1:7777/mcp"
http_headers = { Authorization = "Bearer <token>" }
```

**JSON URL clients — Cursor** (`~/.cursor/mcp.json`), Cline, Continue:

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

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS)
— its config has no `url` field, so bridge the endpoint through
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote) (needs Node):

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

Restart your client. The agent now has the full tool set — profiles (`list_profiles`, `create_profile`, `update_profile`, `delete_profile`, `launch_profile`, `close_profile`), runs (`list_runs`, `close_run`), page driving (`navigate`, `click`, `type`, `extract`, `screenshot`, `evaluate_js`), tabs (`list_tabs`, `new_tab`, `activate_tab`, `close_tab`), cookies (`get_cookies`, `set_cookies`), waits (`wait_for_load`, `wait_for_navigation`, `wait_for_selector`), fingerprints (`list_fingerprint_options`), and raw `cdp_send`.

## Parallel agents: instances and per-run endpoints

Two levels of parallelism, both fully local.

### Named app instances

Launch the app multiple times, each with its own profiles database, settings, and MCP token — all sharing one engine download:

```sh
MultiZen.exe --instance-id=A --mcp-port=12001 --data-dir="D:\MultiZenData"
MultiZen.exe --instance-id=B --mcp-port=12002 --data-dir="D:\MultiZenData" --launch-profile=Work
```

| Flag | Effect |
| --- | --- |
| `--instance-id=<id>` | Run as a named instance (shown in the window title and MCP panel). Launching the same id twice is refused and focuses the existing window. |
| `--data-dir=<path>` | Root for instance data. With an id: `<path>/<id>`; alone: the path itself; an id alone: `<userData>/instances/<id>`. |
| `--mcp-port=<n>` | MCP port for this instance. Priority: CLI > `MULTIZEN_MCP_PORT` > settings > 7777. An explicitly requested busy port fails loudly instead of starting silently without MCP. |
| `--launch-profile=<id\|name>` | Auto-launch that profile once the MCP server is up — agents can connect immediately, no GUI click needed. |
| `--import-profile=<file.mzar>` | Import an encrypted profile archive at startup (`--import-passphrase` supplies the key); pair with `--launch-profile` for scripted spin-ups. |
| `--window=<mode>` | `cascade`, `tile-left`, `tile-right`, or `quad-1..4` window placement — always inside the primary display's work area, never off-screen. |

### Several browsers per profile (runs)

A profile card's **New instance** button (or launching an already-running profile) starts another browser of the same profile. The first run uses the profile's persistent data; each additional run gets a throwaway working copy, so parallel runs never touch the original.

Every live run has its **own MCP endpoint** — its own port and bearer token:

- `list_runs` on the management endpoint returns each run's URL and token (the app's MCP panel shows the same list with copy buttons);
- point an agent at a run's endpoint and every browser tool acts on exactly that browser — no ambiguity, no sharing;
- on the management endpoint, `profile_id` calls work only while the profile has exactly one live run — with several, the call is refused and points you at the per-run endpoints;
- `close_run` stops one run by id, leaving sibling instances running.

### Ephemeral profiles

Mark a profile **Ephemeral** in its editor (or `update_profile` with `ephemeral: true`): every launch materializes a fresh working copy from the template — identity, cookies, and fingerprint included — and the copy is deleted when the browser closes. Good for parallel one-shot tasks where the template must stay pristine.

### Fresh launches

Every launch opens exactly one tab: the profile's start page (DuckDuckGo by default — set it to `about:blank` for a bare window). Tabs from previous runs are never restored, and the "Restore pages?" bubble after a crashed run is suppressed. Cookies, logins, and storage still persist per profile across runs.

## Stack

| Layer | Tech |
| --- | --- |
| Desktop shell | Electron 33 |
| Renderer | React 19, Tailwind v4, TypeScript strict |
| Main process | TypeScript ESM, electron-vite, native MCP SDK |
| MCP server | `@modelcontextprotocol/sdk` over Streamable HTTP + SSE |
| Profile storage | better-sqlite3 with idempotent migrations |
| Browser driver | chrome-remote-interface over CDP |
| Browser engine | CloakBrowser (open-source patched Chromium) |
| Build | Yarn 4 workspaces, electron-vite, electron-builder |
| CI | GitHub Actions matrix on macOS, Windows, Linux |

## Develop

```sh
git clone https://github.com/multizenteam/multizen-browser
cd multizen-browser
yarn install
yarn dev            # launch the desktop app in dev mode
yarn mcp:dev        # run the MCP server standalone for testing
yarn typecheck      # strict TS across all workspaces
yarn build          # full release build (mac/win/linux per OS)
```

Requires Node 22+ and Yarn 4 (via Corepack).

## Repo layout

```
apps/
  desktop/                Electron + React + Tailwind GUI + main process
packages/
  mcp-server/             MCP server exposing the browser-drive tools
  cdp-driver/             Thin wrapper around chrome-remote-interface
  profile-manager/        SQLite profile CRUD + encrypted local storage
  settings-store/         App-level settings persistence
  types/                  Shared TypeScript types
.github/
  workflows/release.yml   Matrix build, tag-triggered
```

## Roadmap

Things landing in upcoming releases.

- **Behavioral injection**: humanized mouse paths, keystroke timing, scroll jitter applied at the CDP input layer.
- **Per-profile cloud sync** (opt-in, end-to-end encrypted): so the same profile follows you across laptops.
- **Team workspaces**: shared profile pool with audit log.

## Why MultiZen vs the alternatives

| | MultiZen | Browserbase / Hyperbrowser | GoLogin / AdsPower / Multilogin |
| --- | :---: | :---: | :---: |
| Native MCP server | yes | yes | profile CRUD only |
| Drives the browser through MCP | yes | yes | no |
| Anti-detect at C++ level | yes | partial | yes |
| Persistent login across sessions | yes | per-session | yes |
| Self-hosted | yes | no | no |
| Manual GUI for operators | yes | no | yes |
| Pay per browser-hour | no | yes | varies |
| Open source core | yes | SDK only | no |

## Acceptable use

Building a multi-account browser is dual-use. We support QA testing across roles and regions, agency workflows you are authorized to run, market research, multi-marketplace e-commerce ops, AI-driven sales engineering, and personal accounts you legitimately own. We do not support platform ToS violations, mass account farming, ban evasion, or fraud. Full policy at [getmultizen.com/acceptable-use](https://getmultizen.com/acceptable-use).

## License

[MIT](LICENSE). Use it however you want.

<div align="center">
  <br/>
  <sub>
    Built in transit by <a href="https://github.com/oboshto">@oboshto</a>.<br/>
    Star this repo if MultiZen is useful, it helps a lot.
  </sub>
</div>
