# busybar-mcp

> [!IMPORTANT]
> Unofficial community project, not affiliated with Flipper Devices / BUSY.

Let Claude and Codex draw and play sounds on your [BUSY Bar](https://busy.app/): text, pixel art, pictures,
animations, melodies, GitHub status and the weather.

Just ask: *"put 'In a meeting' on the Bar"*, *"draw a cat on the back screen"*, *"play a fanfare"*.

## Display orchestration

BusyBar MCP connects directly to the Bar over USB by default. Drawing, sound,
and device diagnostics work with the direct connection.

For shared display orchestration, point BusyBar MCP at
[busybar-wm](https://github.com/viirtualp1/busybar-wm).

```text
AI client → BusyBar MCP → busybar-wm → BUSY Bar
```

When connected through the WM, display commands use its proxy. The WM
arbitrates display ownership and keeps each app's latest frame. Temporary messages and countdowns are drawn as a layer
over the app selected by the WM, so app ownership and input routing continue
underneath. When the overlay expires, the WM removes it and reveals the current
app's frame. Use `bar_clear` to dismiss it sooner. Each display can hold one
overlay at a time, and a new overlay on that display replaces the previous one.

Read-only diagnostics report hardware, battery, firmware, available updates,
Wi-Fi, Bluetooth Low Energy, and the Bar's USB or Wi-Fi transport. Through the
WM, these requests are forwarded to the device without claiming the display.
The diagnostic tools report which readings the device could provide.

## Install

**Claude Code:** type this in Claude Code.

```
/plugin install busybar --marketplace viirtualp1/busybar-mcp
```

**Claude Desktop:** download [`busybar.mcpb`](https://github.com/viirtualp1/busybar-mcp/releases/latest),
double-click it, press **Install**.

**Codex:**

```bash
npx busybar-mcp install --yes
```

### Connect directly

Plug the Bar in over USB and leave the address blank to use `10.0.4.20`.
On Wi-Fi, tell your assistant the Bar's address, for example *"my Bar is at
192.168.1.50"*. You can also use the BUSY cloud endpoint with a token.

### Optional busybar-wm setup

Start [busybar-wm 2.1.0 or later](https://github.com/viirtualp1/busybar-wm#quick-start).
Configure the device address and credentials in
the WM, then set the MCP's `BUSY_ADDR` to the WM's HTTP address, normally
`http://127.0.0.1:4111`. With the Codex installer, pass `--addr <WM URL>`.

If the WM has a `WM_API_TOKEN`, enter the same token in the MCP client settings
or pass `--wm-token <token>` to the installer. The WM requires a token for
control requests from another machine.

> On macOS, allow the app under **System Settings → Privacy & Security → Local Network**,
> or it won't reach the Bar.

## Updating

When a new version is out, Claude or Codex tells you in the next conversation, with what to run:

- **Claude Code:** `/plugin update busybar`
- **Claude Desktop:** download the new `busybar.mcpb` and double-click it
- **Codex:** `npx busybar-mcp@latest update`

What changed is in the [changelog](./CHANGELOG.md). To hear about releases on GitHub: **Watch → Custom → Releases**.

## What it can do

| Tool | |
| --- | --- |
| `busybar_get_status` | WM connection and active app, plus hardware, power, uptime, and firmware update status |
| `busybar_get_connectivity` | Wi-Fi details, BLE status and address, and USB or Wi-Fi transport |
| `busybar_list_apps` | **WM** · list manifest apps and see which have a frame ready |
| `busybar_switch_app` | **WM** · pin a ready app by name |
| `busybar_show_message` | **WM** · show a temporary message for 1–300 seconds |
| `busybar_start_timer` | **WM** · show a countdown for 1–86,400 seconds |
| `busybar_return_to_auto` | **WM** · release the app pin and resume automatic scheduling |
| `busybar_send_input` | **WM** · route an OK or START tap, or an encoder step, to a subscribed WM app |
| `bar_text` | one or two lines of text |
| `bar_pixels` | pixel art |
| `bar_progress` | a progress bar |
| `bar_image` | a picture from a file, a URL or the Bar's stock |
| `bar_animation` | a built-in animation |
| `bar_sound` | a built-in sound, an audio file, or a melody |
| `bar_stock` | list built-in images, animations and sounds |
| `bar_screenshot` | see what the screen shows |
| `bar_clear` | dismiss what the MCP drew and release its claim on the display |
| `bar_connect` | save the WM or Bar address and check reachability |
| `bar_status` | read device status and check reachability |
| `github_ci` | latest CI run of a repo |
| `github_inbox` | PRs to review, your PRs, your issues |
| `weather` | weather for a city |

Works on both screens: the front colour strip and the back greyscale panel.

**Notifications are per request.** Ask your assistant to put a message on the Bar when a task finishes, or ask for a chime.
Updating removes the previous BUSY Bar notification hooks and restores any earlier Codex notifier.

## Settings

Set in the plugin's settings (Claude Code), the extension's (Claude Desktop), or by `bar_connect` and
`npx busybar-mcp install` in `~/.busybar-mcp/config.json`. Environment variables override them.

| Key | |
| --- | --- |
| `BUSY_ADDR` | Bar address (default `10.0.4.20` over USB), or the WM address |
| `WM_API_TOKEN` | control token, if configured on the WM |
| `BUSY_HTTP_PASSWORD` | if the Bar's HTTP access is locked |
| `BUSY_TOKEN` | cloud token, with `BUSY_ADDR=https://api.busy.app` |
| `GITHUB_TOKEN` | otherwise `gh auth token` is used |

## Development

```bash
npm install
npm run build                     # build/server.mjs, build/busybar.mcpb, plugin/
npm test                          # stdio tool tests against mocked HTTP responses
BUSYBAR_DRY_RUN=1 npm run smoke    # preview smoke checks
npm run live                      # media tools on a real Bar
npm run live -- --wm              # diagnostics, temporary message and timer on a real Bar
```

To release: bump `version`, add a `## X.Y.Z` section to `CHANGELOG.md`, `npm run build`, commit, tag `vX.Y.Z` and push.
CI publishes to npm and makes a GitHub release with `busybar.mcpb` and that changelog section.

## License

[MIT](./LICENSE)
