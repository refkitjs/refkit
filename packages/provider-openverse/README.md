# @refkit/provider-openverse

Search **Openverse** (the CC / public-domain media aggregator) as license-normalized image and audio references — a provider satellite for **refkit** (use with [`@refkit/core`](https://www.npmjs.com/package/@refkit/core)).

- **Source:** Openverse ([openverse.org](https://openverse.org))
- **Auth:** keyless
- **Modality:** image · audio
- **License:** per-item Creative Commons / public domain (CC version preserved in `rights.licenseVersion`)

## Usage

```ts
import { createRefkit } from '@refkit/core'
import { openverse, openverseAudio } from '@refkit/provider-openverse'

const refkit = createRefkit({ providers: [openverse(), openverseAudio()] })
const images = await refkit.search({ query: 'lion', modalities: ['image'] })
const audio = await refkit.search({ query: 'rain', modalities: ['audio'] })
// every result carries source + license + attribution + canonicalUrl
```

`openverse()` serves the image leg (source id `openverse`); add `openverseAudio()` for audio (source id `openverse-audio`).

### What an audio result carries

- `thumbnail` is the item's album art, and is unset when Openverse has none. It is never the waveform, which is JSON peak data.
- `kind` is `music` or `sound-effect` when Openverse's `category` says so (`music`, `sound_effect`); other categories (`pronunciation`, `podcast`, `audiobook`, `news`) and a missing one leave it unset. In live results (2026-10) only Jamendo-sourced items carried a mapped category (`music`); Freesound-sourced items carry none, so they have no `kind`.
- `audio.durationSec` (from milliseconds), `audio.bitrateKbps` (from bits per second) and `audio.sampleRateHz`, when Openverse reports them. A missing, non-finite, zero or negative value leaves the field unset (Openverse reports a duration of 0 for MIDI files it never measured).
- `audio.format` and `preview.mediaType` come from one table of known filetypes: `mp3`, `ogg`, `oga`, `opus`, `wav`, `flac`, `mid` / `midi` (`audio/midi`) and `webm` (`audio/webm`). Jamendo's `mp31` / `mp32` read as `mp3`, Wikimedia's `ogx` as `ogg`. An item whose filetype is outside the table has neither `audio.format` nor a `preview`, rather than a guessed media type.

Gate by intended use with `refkit.evaluateUse(ref, 'commercial-product')`. See [`@refkit/core`](https://www.npmjs.com/package/@refkit/core) for the full API.
