---
"@refkit/mcp": minor
---

`REFKIT_MAX_CURSOR_SEEN` env var for the zero-config CLI: caps how many
already-returned keys the load-more cursor remembers (core's `maxCursorSeen`),
for hosts that clamp tool-output strings — the default 500-key cursor is ~2.7k
chars; `REFKIT_MAX_CURSOR_SEEN=200` brings it near ~1.1k. Invalid values warn
on stderr and fall back to the core default.
