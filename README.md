# busybar-mcp

> [!IMPORTANT]
> **Unofficial community project**, not affiliated with Flipper Devices / BUSY. "BUSY Bar" is their trademark.

An MCP server that lets Claude (Desktop, Code) and Codex draw and play sounds on a [BUSY Bar](https://busy.app/):
status text, pixel art, pictures, animations, melodies, your GitHub CI and inbox, the weather — on both screens.

Every drawing tool returns a preview image, so the model sees what it drew and can fix it.

## Install

### Claude Desktop: no terminal

1. Download `busybar.mcpb` from the [latest release](https://github.com/viirtualp1/busybar-mcp/releases/latest).
2. Double-click it. Claude Desktop opens an install dialog.
3. Fill in the Bar's address if it isn't plugged in over USB. Tokens are stored in the system keychain.

It shows up in **Settings → Extensions**, where you can turn it off, update or remove it.

### Claude Code, Codex and Claude Desktop: one command

```bash
npx busybar-mcp install
```

It asks for the Bar's address (and a password or tokens if you need them), checks the Bar answers, and registers
itself in every client it finds:

| Client | How |
| --- | --- |
| Claude Code | `claude mcp add -s user`, so it is in every project and in the desktop app's Code tab |
| Codex | `[mcp_servers.busybar]` in `~/.codex/config.toml` |
| Claude Desktop | opens the bundled extension; `--desktop-json` writes `claude_desktop_config.json` instead |

Every config file it touches is backed up next to itself as `*.bak-busybar`, and only the `busybar` entry changes.

Settings live in `~/.busybar-mcp/config.json` (mode 600), not in the clients' configs, so changing the Bar's address
is one more `npx busybar-mcp install`.

```bash
npx busybar-mcp doctor      # where it is installed, and whether the Bar answers
npx busybar-mcp uninstall   # remove it from every client
```

Unattended: `npx busybar-mcp install --yes --addr 192.168.1.50 --only claude-code,codex`.

## Tools

| Tool | What it does |
| --- | --- |
| `bar_text` | one or two lines, optional accent band and LED blink |
| `bar_pixels` | pixel art from a palette and a character grid, optional caption |
| `bar_progress` | labelled progress bar |
| `bar_image` | a picture from a path or URL (PNG; JPEG, GIF, HEIC, WebP on macOS), or a stock image |
| `bar_animation` | one of the Bar's stock animations (`coding_72x16.anim`, `on_air_72x16.anim`, …) |
| `bar_sound` | a stock sound, an audio file (WAV; MP3, M4A, AIFF on macOS or with ffmpeg), or a melody |
| `bar_stock` | the images, animations and sounds built into the Bar |
| `bar_clear` | give one screen, or both, back to the Bar |
| `bar_screenshot` | what a screen shows right now |
| `bar_status` | which Bar, and whether it answers |
| `github_ci` | latest Actions run for `owner/repo` |
| `github_inbox` | review requests, your open PRs, issues assigned to you |
| `weather` | current weather for a city (Open-Meteo, no key) |

Every drawing tool takes `display: "front" | "back"`. The front is the 72×16 colour strip people see; the back is the
160×80 greyscale OLED facing you. Pictures and pixel art are dithered to its 16 greys. Drawing on one screen leaves
the other alone.

After a draw the tool returns a photo of the real screen; with no Bar (or in a dry run), a preview.

Pictures are scaled to fit and uploaded once (they are named by content). Melodies are written as notes:
`"C5:150 E5:150 G5:150 C6:400"`, `R` for a rest, `C4+E4+G4:500` for a chord, in a square, sine, triangle or saw
voice. Sounds are converted to the Bar's `.snd` (mono 16-bit PCM, 44.1 kHz) in the server. Custom animations are
not supported: `.anim` is a closed format.

Calendar, mail and the rest come from the client's own connectors: ask "show my next meeting on the Bar" and the model
reads your calendar and calls `bar_text`.

The server draws at priority 40, below an active BUSY work session, so it never interrupts one unless the model
passes `urgent: true` (when you ask it to).

## Settings

| Key | Meaning |
| --- | --- |
| `BUSY_ADDR` | Bar address; default `10.0.4.20` (USB). `https://api.busy.app` with a cloud token reaches it from anywhere |
| `BUSY_HTTP_PASSWORD` | if HTTP access on the Bar is locked |
| `BUSY_TOKEN` | cloud token from cloud.busy.app/api-tokens |
| `GITHUB_TOKEN` | otherwise `gh auth token` is used |
| `DRAW_PRIORITY` | 1–100, default 40 |
| `BUSYBAR_DRY_RUN` | `1`: never touch the device, previews only |

Environment variables win over `~/.busybar-mcp/config.json`.

## Development

```bash
npm install
npm run build                     # build/server.mjs + build/busybar.mcpb
BUSYBAR_DRY_RUN=1 npm run smoke   # call every tool, write preview-*.png
npm run live                      # walk through the media tools on a real Bar, write live-*.png
npm run dev -- install --only codex
```

Built on [`@busy-app/busy-lib`](https://github.com/busy-app/busylib-ts) and
[`busybar-kit`](https://github.com/viirtualp1/busybar-kit), bundled into one file with esbuild,
so the published package has no runtime dependencies.

Releases: bump `version` in `package.json`, commit, tag `vX.Y.Z` and push. CI publishes to npm and attaches
`busybar.mcpb` to the GitHub release.

## License

[MIT](./LICENSE)
