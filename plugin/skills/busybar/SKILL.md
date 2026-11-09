---
name: busybar
description: Show things on the user's BUSY Bar (an LED status display with a 72x16 colour front and a 160x80 greyscale back) and play sounds on it, through the busybar MCP tools. Use whenever the user mentions the Bar, BUSY Bar, busybar, their status display, or asks to show, draw, display, notify or play something "on the bar".
---

# BUSY Bar

The busybar MCP server's tools do the work; this skill says how to use them well.

- Only send a notification or play a chime when the user explicitly asks for it. For a requested
  completion notification, use `bar_text` when the task finishes, and `bar_sound` if they asked for sound.
- Text: `bar_text` (one or two lines). Pixel art: `bar_pixels`. Pictures: `bar_image` (path or URL).
  Built-in media: `bar_stock` lists it, then `bar_animation`, `bar_image` with `stock`, `bar_sound` with `stock`.
  Melodies: `bar_sound` with `melody`, e.g. "C5:150 E5:150 G5:150 C6:400".
- `display: "front"` is the strip other people see; `"back"` faces the user and holds more text.
- The fonts are ASCII only. Non-Latin text is transliterated, so keep it short and plain.
- Front fits about 17 characters per line; write a status, not a sentence.
- Every drawing tool returns an image of the result. Look at it, and redraw if it is wrong.
- "Not drawn due to low priority" means a BUSY work session owns the Bar. Pass `urgent: true` only if the user
  asked to interrupt it.
- When finished with a temporary message, `bar_clear` gives the screen back.
- Combine with other tools: read the calendar, mail or CI first, then show the result on the Bar.
