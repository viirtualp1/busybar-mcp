# busybar-mcp

MCP server that lets an LLM draw on a BUSY Bar and push GitHub / weather onto it.
Built on `@busy-app/busy-lib` 1.0 (transport) and `busybar-kit` (config + PNG preview).

Every drawing tool returns a PNG preview, so the model sees what it drew — even with no Bar connected.

## Tools

| Tool | What it does |
| --- | --- |
| `bar_text` | one or two lines, optional accent band and LED blink |
| `bar_pixels` | pixel art from a palette + char grid (XPM2 under the hood), optional caption |
| `bar_progress` | labelled progress bar |
| `bar_clear` | give the screen back to the Bar |
| `bar_screenshot` | what the real screen shows now |
| `bar_status` | which Bar, reachable or not |
| `github_ci` | latest Actions run for `owner/repo` |
| `github_inbox` | review requests / my PRs / assigned issues |
| `weather` | Open-Meteo, no key |

## Config (env)

- `BUSY_ADDR` — Bar IP; default `10.0.4.20` (USB). `https://api.busy.app` + `BUSY_TOKEN` for cloud.
- `BUSY_HTTP_PASSWORD` — if HTTP access is locked.
- `BUSYBAR_DRY_RUN=1` — never touch the device, previews only.
- `GITHUB_TOKEN` — otherwise `gh auth token` is used.

## Run

```bash
npm run build
claude mcp add busybar -e BUSY_ADDR=10.0.4.20 -- node "$PWD/dist/index.js"
BUSYBAR_DRY_RUN=1 npm run smoke   # calls every tool, writes preview-*.png
```

`busybar-kit` is linked from `~/Documents/personal/busybar-kit` (branch `busylib-1.0`) until a release with busy-lib 1.0 support is published.
