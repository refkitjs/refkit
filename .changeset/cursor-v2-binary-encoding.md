---
"@refkit/core": minor
---

Shrink the load-more cursor to roughly half its size: `meta.nextCursor` is now
a binary-packed base64url string (magic + version + page + raw fnv1a uint32
seen-keys) instead of v1's JSON array of base36 hash strings — a full 500-entry
cursor drops from ~5k to ~2.7k chars. Cursors ride inside LLM tool outputs
downstream (and get replayed through conversation history), so every char
counts; ~2.7k also clears consumers that clamp tool-output strings at 4k.

The cursor stays opaque and self-contained: pass back `meta.nextCursor`, get
the next deduped batch, no caller-side bookkeeping, no client instance state.
Anything else — including a v1 JSON cursor from a previous release — still
fails loudly with "invalid cursor" rather than quietly restarting from page 1
(cursors are short-lived load-more state, not durable ids; there is no v1
migration).

New `createRefkit({ maxCursorSeen })` caps how many already-returned keys the
cursor remembers (default unchanged at 500, most recent kept, ~5.4 chars each)
for callers who want an even tighter cursor and can accept re-showing
long-evicted results sooner. `Infinity` disables the cap; the effective floor
is the batch just returned, so a too-small cap can never make load-more repeat
the batch it just handed back.

Hardening over v1, both restoring guarantees the removed zod schema provided:
an out-of-uint32-range `controls.page` (negative, fractional, `NaN`, ≥ 2^32)
encodes as a poison cursor that fails loudly on the next call instead of
silently wrapping to a different page, and non-canonical base64url (tampered
trailing bits) is rejected rather than silently aliased to a valid cursor.
