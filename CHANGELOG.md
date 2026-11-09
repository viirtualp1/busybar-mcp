# Changelog

## 0.12.0

- A Codex plugin, from the same repository as the Claude Code one: `codex plugin marketplace add viirtualp1/busybar-mcp`,
  then `codex plugin add busybar@busybar`. No installer, no edits to your Codex config, updates through Codex.
- It starts even when Node is not on the app's PATH: the launcher uses the Node that Codex ships with, then the usual
  places (Homebrew, nvm).

## 0.11.0

- Made for everyone, not just developers: plug the Bar in or keep it on the same Wi-Fi, and Claude finds it by itself.
  `bar_connect` without an address looks for it too, and asks which one when there are several Bars.
- Ready-made actions in the Claude app's + menu: set up the Bar, set a status, focus timer, weather, and
  "tell me on the Bar when you finish".
- `bar_set_status`: meeting, call, focus, lunch, back soon and more, with the Bar's own animations, optionally for
  a number of minutes.
- `bar_timer`: a countdown the Bar runs by itself, with a chime at the end. No busybar-wm needed.
- Only the tools that can work are offered: the busybar-wm tools appear once a WM is found, the GitHub tools when
  there is a token or the `gh` CLI.
- Errors say what to do in plain words, and an unreachable Bar is reported after 4 seconds instead of 10.
- The README starts with what to install and what to say.

## 0.10.0

- Set an optional LAN fallback address for the same Bar. The MCP prefers USB and uses LAN when USB is unreachable.
- Reconnecting USB restores USB preference on the next command. An explicit window manager or cloud address keeps its existing routing.

## 0.9.0

- Connect directly over USB with the default settings to draw, play sounds, and read device diagnostics.
- Read battery, uptime, firmware and update status, Wi-Fi, Bluetooth Low Energy, and USB transport details.
- Connect through busybar-wm 2.1.0 or later for app switching, automatic scheduling, input routing, temporary messages, and countdowns. The window manager reveals the app underneath when an overlay expires.

## 0.8.0

- The Bar stays on your chosen display when Claude Code or Codex finishes a turn or waits for input. Ask your assistant for a Bar notification when you want one.
- Updating removes legacy BUSY Bar hooks and restores any previous Codex notifier.

## 0.7.1

- The back screen shows up to three lines of the answer, with Markdown and brief opening filler removed.
  Longer answers are shortened to fit at a sentence or word boundary.

## 0.7.0

- Notifications are glanceable instead of a scrolling paragraph: the logo, **Ready** / **Needs you**, the time, the
  project and how long the turn took; the date only when the day changed. The back keeps a two-line gist.

## 0.6.0

- Tells you when a new version is out: `bar_status` and the first answer of a session mention it, with how to update.
- `npx busybar-mcp@latest update` updates every install on the machine (Claude Code, Codex, Claude Desktop) and
  keeps your choices.
- `npx busybar-mcp doctor` says whether you are up to date.

## 0.5.0

- Notifications show the Claude or Codex logo, measured from the apps' own icons.
- `bar_text` takes `logo: "claude" | "codex"`.

## 0.4.0

- Claude Code plugin: `/plugin install busybar --marketplace viirtualp1/busybar-mcp`, no terminal.
- `bar_connect`: tell Claude where your Bar is.

## 0.3.0

- Answer-ready notifications on the Bar for Claude Code and Codex, with a summary of the answer.
- A `busybar` skill for Claude Code and Codex.
- Russian and other Cyrillic text is transliterated for the Bar's fonts.

## 0.2.0

- Back screen, pictures, stock animations, sounds and melodies.
- Tools return a photo of the real screen after drawing.

## 0.1.0

- First version: text, pixel art, progress, GitHub and weather on the front screen.
- One-command installer and a Claude Desktop extension.
