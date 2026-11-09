---
name: busybar
description: Show things on the user's BUSY Bar (an LED status display with a 72x16 colour front and a 160x80 greyscale back) and play sounds on it, through the busybar MCP tools. Use whenever the user mentions the Bar, BUSY Bar, busybar, their status display, or asks to show, draw, display, notify or play something "on the bar".
---

# BUSY Bar

The busybar MCP server's tools do the work; this skill says how to use them well.

- Talk to the user in plain words. Many are not technical: never mention tool names, HTTP, IP addresses or
  error codes unless they ask. Pass on the tools' own explanations of what to check.
- Status ("I'm in a meeting", "on a call", "lunch", "focus"): `bar_set_status`, with `minutes` if they say how long.
- Timers ("25-minute focus", "tea in 4 minutes"): `bar_timer`. It counts on the Bar by itself and chimes at the end.
- Text: `bar_text` (one or two lines, `logo: "claude"` to sign it). Pixel art: `bar_pixels`. Pictures: `bar_image`
  (path or link). Built-in media: `bar_stock`, then `bar_animation`, `bar_image` with `stock`, `bar_sound` with `stock`.
  Melodies: `bar_sound` with `melody`, e.g. "C5:150 E5:150 G5:150 C6:400". Weather: `weather`.
- Only notify or play a chime when the user asked for it. For "tell me when you're done", finish with `bar_text`
  (logo, "Ready" and a few words), and `bar_sound` if they asked for sound.
- If the Bar cannot be reached, call `bar_connect` without an address: it looks for the Bar on the Wi-Fi. With
  several Bars found, ask which one is theirs.
- `display: "front"` is the strip other people see; `"back"` faces the user and holds more text.
- The fonts are ASCII only. Non-Latin text is transliterated, so keep it short and plain. The front fits about
  17 characters per line: write a status, not a sentence.
- Drawing tools return an image of the result. Look at it, and redraw if it is wrong.
- "Busy with something more important" means a focus session or another app owns the Bar. Pass `urgent: true`
  only if the user asked to interrupt it.
- `bar_clear` gives the screen back when a temporary message is done.
- Combine with other tools: read the calendar, mail or CI first, then show the result on the Bar.
- With busybar-wm (developers only) more tools appear: `busybar_show_message` for text that disappears by itself,
  `busybar_list_apps` / `busybar_switch_app` / `busybar_return_to_auto` for apps. `busybar_get_status` and
  `busybar_get_connectivity` read diagnostics.
