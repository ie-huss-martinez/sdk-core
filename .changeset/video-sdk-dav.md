---
"@hussmartinez/video-sdk": patch
---

The SDK opens DAV recordings, the `DHAV` files Dahua recorders and cameras write. A `.dav` file probes, plays, trims and exports to MP4 or WebM like any other source, on the device: H.264, or HEVC where the browser decodes it, with G.711 or 16-bit PCM sound. The editor's file pickers and drop zone accept `.dav`.

- `VideoContainer` gains `"dav"`, which a probe's and a source's `container` can now be. Code that handles every container, such as a `switch` with no default, needs a case for it.
- Gaps in a recording, and jumps in the recorder's clock, are closed: the timeline runs on as if nothing were missing, and the recording's dates aren't kept.
- A recording whose sound is AAC, MP2, MP3 or ADPCM opens with its picture and without sound, and its source's `unplayableAudio` names the codec, as for sound a browser can't decode.

A host with its own file input adds `.dav` to its `accept`: browsers give these files no MIME type, so list the extension. Nothing else changes for existing callers.
