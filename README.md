# BUSY Bar for AI assistants

> [!IMPORTANT]
> Unofficial community project, not affiliated with Flipper Devices / BUSY.

Talk to Claude or Codex, and your [BUSY Bar](https://busy.app/) does it: shows that you are in a meeting, counts
down a focus session, puts up a note, a picture or the weather, plays a little melody.

Works with the **Claude app**, **Claude Code** and **Codex**, and with any other app that supports MCP.

## Install

Pick the app you use:

**Claude app (Mac or Windows)**

1. Download [**busybar.mcpb**](https://github.com/viirtualp1/busybar-mcp/releases/latest/download/busybar.mcpb).
2. Double-click it and press **Install**.

**Claude Code** — type this in Claude Code:

```
/plugin install busybar --marketplace viirtualp1/busybar-mcp
```

**Codex** — run these two in a terminal, then start a new chat:

```bash
codex plugin marketplace add viirtualp1/busybar-mcp
codex plugin add busybar@busybar
```

<sub>Older Codex without plugins, or another MCP app: `npx busybar-mcp install --yes`.</sub>

Then plug your Bar in with its USB cable, or keep it on the same Wi-Fi as your computer. That's it: your assistant
finds it.

On a Mac, the first time, allow the app to see devices on your network:
**System Settings → Privacy & Security → Local Network** → switch on **Claude** (or **ChatGPT**, for Codex).

## Try saying

- *"Set my status to In a meeting for 30 minutes"*
- *"Start a 25-minute focus timer"*
- *"Put 'Back at 3' on the Bar"*
- *"Show the weather in Berlin on the Bar"*
- *"Draw a cat on the back screen"*
- *"Play a happy little tune"*
- *"Clean up the report, and tell me on the Bar when you're done"*

In the Claude app, ready-made actions are also in the **+** menu: *Set up my BUSY Bar*, *Set my status*,
*Focus timer*, *Weather on the Bar*, *Tell me on the Bar when you finish*.

The front of the Bar is the colour strip other people see; the back is the screen facing you.

## If it doesn't work

Ask your assistant *"set up my BUSY Bar"*: it checks the connection and walks you through it. The usual fixes:

- **Not found:** plug the Bar in with the USB cable, or make sure it is on and on the same Wi-Fi as your computer.
- **On a Mac:** System Settings → Privacy & Security → **Local Network** → switch on Claude (or ChatGPT, for Codex),
  then restart the app.
- **Still nothing:** the Bar shows its address under **Settings → Wi-Fi**. Say *"my Bar is at …"*.
- **Nothing shows up during a focus session:** the Bar keeps its own session on screen. Say *"show it anyway"*.

## Updating

When a new version is out, your assistant tells you in the next conversation and how to get it:

- **Claude app:** download the new `busybar.mcpb` and double-click it
- **Claude Code:** `/plugin update busybar`
- **Codex:** `codex plugin marketplace upgrade busybar`, then `codex plugin add busybar@busybar`

What changed is in the [changelog](./CHANGELOG.md).

---

## For developers

<details>
<summary>All tools</summary>

| Tool | |
| --- | --- |
| `bar_set_status` | a ready-made status from the Bar's own animations: meeting, call, focus, lunch, back soon… |
| `bar_timer` | a countdown the Bar runs by itself, with a chime at the end |
| `bar_text` | one or two lines of text, optionally with the Claude or Codex logo |
| `bar_pixels` | pixel art |
| `bar_progress` | a progress bar |
| `bar_image` | a picture from a file, a URL or the Bar's stock |
| `bar_animation` | a built-in animation |
| `bar_sound` | a built-in sound, an audio file, or a melody |
| `bar_stock` | list built-in images, animations and sounds |
| `bar_screenshot` | see what the screen shows |
| `bar_clear` | dismiss what the MCP drew |
| `bar_connect` | find the Bar on the Wi-Fi, or save an address |
| `bar_status` | device status and reachability |
| `busybar_get_status` | hardware, power, uptime, firmware and updates (and the WM, when there is one) |
| `busybar_get_connectivity` | Wi-Fi, BLE and USB or Wi-Fi transport |
| `weather` | weather for a city |
| `github_ci`, `github_inbox` | CI status and GitHub inbox; shown when a GitHub token or the `gh` CLI is available |
| `busybar_list_apps`, `busybar_switch_app`, `busybar_show_message`, `busybar_start_timer`, `busybar_return_to_auto`, `busybar_send_input` | **busybar-wm** only; shown once a WM is detected |

The server also offers the prompts above (`setup`, `status`, `focus`, `weather`, `tell_me_when_done`).
Notifications are per request: nothing is shown or played unless you ask.
</details>

<details>
<summary>Connection</summary>

The Bar is reached over USB (`10.0.4.20`) by default. When USB does not answer and no Wi-Fi address is saved, the
server looks for the Bar on the network once (mDNS, `busybar-*._http._tcp`) and remembers it as the Wi-Fi fallback;
with several Bars it asks which one. USB is preferred again as soon as it answers.

You can also set addresses yourself: `bar_connect` with `addr` (and `lan_addr` for the USB-plus-Wi-Fi case), the
extension or plugin settings, or `npx busybar-mcp install --addr 10.0.4.20 --lan-addr 192.168.1.50`. The BUSY cloud
works too, with `https://api.busy.app` and a token.

| Key | |
| --- | --- |
| `BUSY_ADDR` | Bar address (default `10.0.4.20` over USB), or the WM address |
| `BUSY_LAN_ADDR` | Wi-Fi address of the same Bar, used when USB does not answer |
| `BUSY_HTTP_PASSWORD` | if the Bar's HTTP access is locked |
| `BUSY_TOKEN` | cloud token, with `BUSY_ADDR=https://api.busy.app` |
| `WM_API_TOKEN` | control token, if configured on the WM |
| `GITHUB_TOKEN` | otherwise `gh auth token` is used |

Settings live in `~/.busybar-mcp/config.json`; environment variables override them.
</details>

<details>
<summary>busybar-wm</summary>

For shared display orchestration, point the server at
[busybar-wm 2.1.0 or later](https://github.com/viirtualp1/busybar-wm#quick-start) (`BUSY_ADDR`, normally
`http://127.0.0.1:4111`, plus `WM_API_TOKEN` if the WM has one):

```text
AI client → busybar-mcp → busybar-wm → BUSY Bar
```

The WM arbitrates display ownership and keeps each app's latest frame. Temporary messages and countdowns are drawn
as an overlay over the selected app, and the WM reveals the app again when they expire. Each display holds one
overlay at a time. Diagnostics are forwarded to the device without claiming the display.
</details>

<details>
<summary>Building and releasing</summary>

```bash
npm install
npm run build                     # build/server.mjs, build/busybar.mcpb, plugin/ (Claude Code + Codex)
npm test                          # stdio tool tests against mocked HTTP responses
BUSYBAR_DRY_RUN=1 npm run smoke   # preview smoke checks
npm run live                      # media tools on a real Bar
npm run live -- --wm              # diagnostics, temporary message and timer through a WM
```

To release: bump `version`, add a `## X.Y.Z` section to `CHANGELOG.md`, `npm run build`, commit, tag `vX.Y.Z` and
push. CI publishes to npm and makes a GitHub release with `busybar.mcpb` and that changelog section.
</details>

## License

[MIT](./LICENSE)
