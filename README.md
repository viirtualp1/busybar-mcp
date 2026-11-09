# busybar-mcp

> [!IMPORTANT]
> Unofficial community project, not affiliated with Flipper Devices / BUSY.

Let Claude and Codex draw and play sounds on your [BUSY Bar](https://busy.app/): text, pixel art, pictures,
animations, melodies, GitHub status and the weather.

Just ask: *"put 'In a meeting' on the Bar"*, *"draw a cat on the back screen"*, *"play a fanfare"*.

## Install

**Claude Desktop:** download [`busybar.mcpb`](https://github.com/viirtualp1/busybar-mcp/releases/latest),
double-click it, press **Install**.

**Claude Code, Codex** (and Claude Desktop too):

```bash
npx busybar-mcp install
```

Then plug the Bar in over USB, or enter its Wi-Fi IP when asked.

> On macOS, allow the app under **System Settings → Privacy & Security → Local Network**,
> or it won't reach the Bar.

`npx busybar-mcp doctor` checks the setup, `npx busybar-mcp uninstall` removes it.

## What it can do

| Tool | |
| --- | --- |
| `bar_text` | one or two lines of text |
| `bar_pixels` | pixel art |
| `bar_progress` | a progress bar |
| `bar_image` | a picture from a file, a URL or the Bar's stock |
| `bar_animation` | a built-in animation |
| `bar_sound` | a built-in sound, an audio file, or a melody |
| `bar_stock` | list built-in images, animations and sounds |
| `bar_screenshot` | see what the screen shows |
| `bar_clear` | give the screen back to the Bar |
| `bar_status` | is the Bar reachable |
| `github_ci` | latest CI run of a repo |
| `github_inbox` | PRs to review, your PRs, your issues |
| `weather` | weather for a city |

Works on both screens: the front colour strip and the back greyscale panel.

**Answer-ready notifications.** When Claude Code or Codex finishes an answer, the Bar shows a short summary of it,
blinks and chimes; Claude Code also shows when it is waiting for your permission. Turn it off with
`npx busybar-mcp install --no-notify`.

## Settings

Saved by `npx busybar-mcp install` in `~/.busybar-mcp/config.json`; environment variables override them.

| Key | |
| --- | --- |
| `BUSY_ADDR` | Bar address, default `10.0.4.20` (USB) |
| `BUSY_HTTP_PASSWORD` | if the Bar's HTTP access is locked |
| `BUSY_TOKEN` | cloud token, with `BUSY_ADDR=https://api.busy.app` |
| `GITHUB_TOKEN` | otherwise `gh auth token` is used |

## Development

```bash
npm install
npm run build                     # build/server.mjs + build/busybar.mcpb
BUSYBAR_DRY_RUN=1 npm run smoke   # every tool, no Bar needed
npm run live                      # media tools on a real Bar
```

To release, bump `version`, tag `vX.Y.Z` and push: CI publishes to npm and attaches `busybar.mcpb` to the release.

## License

[MIT](./LICENSE)
