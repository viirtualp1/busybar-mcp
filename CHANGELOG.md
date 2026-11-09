# Changelog

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
