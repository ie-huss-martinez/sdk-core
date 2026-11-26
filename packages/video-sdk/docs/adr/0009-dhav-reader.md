# 0009. DAV recordings: the SDK's own DHAV reader, feeding WebCodecs as the recorder wrote

- **Status:** Accepted; refines [0001](0001-video-engines.md)
- **Date:** 2026-11-26

## Context

DAV is what Dahua recorders and cameras write, and what their owners export: the `DHAV` container. Those clips are what people want to trim and share without uploading them ([#228](https://github.com/ie-huss-martinez/sdk-core/issues/228)). The application this SDK replaces opened them only by sending them to a server that ran FFmpeg. The family runs in the browser alone.

[ADR 0001](0001-video-engines.md) reads containers with mediabunny and refuses everything but ISOBMFF and Matroska. mediabunny 1.65.2 doesn't read DHAV, and has no way to add a format from outside.

What makes DHAV different from the two families the SDK already reads:

- **It has no index.** A file is a run of frames, each with its own header. Nothing says how many there are, how long the recording is, or where a time is: a reader finds out by walking every frame.
- **Its streams are bare.** A picture is H.264 or HEVC in Annex B, with its parameter sets in the stream, as the encoder wrote it. Sound is usually G.711. There are no codec configuration records.
- **Its times are a recorder's clock.** Each frame carries a date to the second and a 16-bit millisecond counter that wraps every 65.5 s. A recorder that records on motion leaves gaps of hours, and its clock is set, corrected and reset while it records.
- **Nothing describes it but other readers.** There's no public specification. FFmpeg's `libavformat/dhav.c` is the reference this record uses for the layout: the header, the extension tags, and the codec and sample-rate tables. It's LGPL, so it was read for the format's facts and none of its code was copied.
- **No real recording was read for this record,** and none may be committed (CONTRIBUTING.md, "Test videos"). What it decides is proved on generated files that FFmpeg's own DHAV reader also reads.

Measured in the pinned image on 2026-11-26, with the generated fixture: Chromium 159, Firefox 159 and WebKit 27.2 all decode H.264 given as Annex B to a `VideoDecoder` configured without a `description`, and all three decode A-law and µ-law through `AudioDecoder` (`alaw`, `ulaw`). WebKit alone decodes HEVC, as for MP4 ([capability matrix](../capabilities.md)).

## Decision

**The SDK reads DHAV with its own reader,** `src/adapters/dhav/`, and hands its packets to WebCodecs as the recorder wrote them. Nothing is remuxed, and no dependency is added. It runs only in the workers, like every reader ([ADR 0002](0002-workers-and-assets.md)), and everything after it is unchanged: the probe's limits, decoding, playback, and exports that re-encode every frame ([ADR 0001](0001-video-engines.md)).

### One walk is the front check, the packet walk and the index

- **Recognised by signature,** as the other containers are: a first frame's `DHAV`, or the 1,024-byte `DAHUA` file header some recorders write before it. Never by the name or the type: browsers give `.dav` no MIME type.
- **The front check walks every frame,** through `sdk-core`'s windowed reader, never loading the file whole. Since no other code parses a DHAV file, this walk is the whole reading. Its result carries the index it built, so a probe, an open or a decode walks the file once.
- **Every frame is checked before it's believed:**
  - its length must cover its own header, extension area and trailer, and fit the bytes that remain;
  - its trailer must start with `dhav`.

  A frame that fails either is malformed: `INVALID_VIDEO`, with `details.reason` `"truncated"`, `"frame-size"` or `"frame-trailer"`. The header's checksum byte and the trailer's length aren't checked: FFmpeg checks neither, and their exact meaning can't be confirmed without a recording.
- **What isn't a picture or sound is skipped:** data frames (`0xF1`), types the format doesn't name, frames with no payload, and bytes between frames up to the next `DHAV`. Each byte of a file is looked at once.
- **The walk can't run away.** It stops with the same errors as mediabunny's packet walk: `FRAME_RATE_TOO_HIGH` and `DURATION_TOO_LONG` past the packet caps, and `INVALID_VIDEO` (`"too-many-elements"`) past the caps plus the margin, counting every frame of every kind.
- **The index is what `maxIndexSize` bounds.** It holds 21 bytes for each picture and 20 for each sound frame: where its payload is, its size, its time, and whether it's a key picture. The walk fails with `INDEX_TOO_LARGE` as soon as it would hold more. Payloads are never held: a decoder's loop reads each one from the `Blob` when it's wanted.

### The picture

- **One stream:** the channel of the first key picture (`0xFD`). Pictures before it can't be decoded and are left out. Other channels are counted as tracks, against `maxTracks`, and skipped.
- **The codec and the size come from the stream, never from the header.** The first key picture's sequence parameter set is parsed, as H.264 or as HEVC, for the codec string and the cropped size. The header's codec number only says which to try first, and refuses MPEG-4 and MJPEG with `UNSUPPORTED_CODEC`. A key picture without a parameter set that reads is `INVALID_VIDEO` (`"parameter-sets"`). So the probe's limits are checked against what the bitstream declares, and every decoded frame is still checked against the probe ([ADR 0001](0001-video-engines.md)).
- **Annex B goes to the decoder as it is:** `VideoDecoder` is configured with the codec string and the size and no `description`, which WebCodecs defines as Annex B for both codecs. The SDK doesn't rewrite start codes or build `avcC` or `hvcC` records.
- **Pictures are taken in the order they're stored.** Recorders don't write B-frames, and the format has one time per frame. A stream that reorders pictures would decode with its frames out of order.
- **Pixels are square, and nothing is turned.** The stream's sample aspect ratio isn't read.

### The sound

- **One stream:** the first sound frame (`0xF0`) that declares its channels, codec and sample rate, on its channel.
- **G.711 A-law, µ-law and 16-bit PCM are played.** They're plain samples, so a frame's length is its bytes, and `AudioDecoder` takes them as they are.
- **AAC, MP2, MP3, ADPCM and 8-bit PCM are named, not played.** How a recorder frames them inside a DHAV frame can't be shown by a generated file. Such a file opens with its picture, and its source says which sound it couldn't play, exactly as for sound a browser can't decode ([ADR 0008](0008-audio-editing.md)). Playing them is a later change, made against a real recording.
- **Sound with a codec or a sample rate the format doesn't name is left out,** and still counted as a track.

### One timeline, with the recorder's jumps closed

Times come from the millisecond counter, in file order, for the picture and the sound together, so the two stay in step.

- **A step is followed** when it's small and the dates agree with it. That keeps a dropped picture's gap, and follows the counter through its wrap.
- **A jump is closed.** A step of more than half a second or four picture periods, whichever is longer, in either direction, or one the dates contradict by more than two seconds, is a gap in the recording or a change to the recorder's clock. The timeline goes on from where it was: the next picture plays one picture period after the last, as the recorder declared its frame rate, or 40 ms without one.
  - **Why closed:** an editor's timeline with hours of nothing between two events is no use, and would run into `maxDuration`. Players of these files skip gaps too.
  - **Why for both tracks at once:** decoded sound is already placed end to end ([ADR 0001](0001-video-engines.md)), so a gap kept in the picture alone would leave the sound early for the rest of the file.
  - **Why the dates as well:** a jump of a whole number of counter wraps looks like no step at all.
- **A track's times never go back.** Two pictures with one time play a millisecond apart.
- **The recording's dates aren't kept.** A source's time starts at its first picture, as for every container. No date or channel reaches the session, the plan or an export.

### A seam under the decoders

The decode loops took mediabunny's track and made its `EncodedPacketSink` themselves. They now take the packets: `getFirstPacket`, `getKeyPacket` or `getPacket`, and `getNextPacket`, with a packet that gives its time and an `EncodedVideoChunk` or `EncodedAudioChunk`. That's the part of `EncodedPacketSink` they used, so mediabunny's sink is passed as it is, and the DHAV reader implements the same three methods over its index.

- **`openTracks(file, frontCheck)`** opens either reader behind one shape, and the frame reader, the support check and the waveform use it. They no longer import mediabunny, though they stay in `src/adapters/mediabunny/` for now: moving them is a rename for a pull request of its own.
- **Only `src/adapters/mediabunny/` imports mediabunny,** as before. `src/adapters/dhav/` imports nothing but `sdk-core`.

### The editor

The file pickers and the drop zone accept `.dav` by its extension, since it has no MIME type. `VideoContainer` gains `"dav"`. Exports are still MP4 or WebM.

### Hostile-input code, tested as such

- **Bounded by construction,** as ADR 0001 requires: every loop advances or is counted, every size is checked against the bytes that remain, the parameter-set parser checks every bit it reads, and nothing is allocated from a size a file declares.
- **The same corpus as the other readers:** a fixture cut at every byte offset, random bytes behind a valid signature, frames with wrong lengths, and mutated fixtures, each settling quickly with a probe or one of the probe's codes.
- **Fixtures are generated:** `scripts/make-dav-fixtures.ts` has FFmpeg encode a frame-numbered picture and a tone into bare H.264, HEVC and A-law, and wraps them in DHAV frames with the tests' builder, because FFmpeg reads DHAV but doesn't write it. FFmpeg's reader reading the result back is the check that the builder writes the layout it describes.
- **In each browser engine,** the tests probe the fixture, decode every picture and the sound, seek the preview to exact pictures, and export it and read the export's frames back. A browser that stops decoding Annex B or G.711 fails them.

## Alternatives considered

- **Remuxing into MP4 or Matroska in memory, for mediabunny to read:** nothing else would change, and mediabunny would build the codec records. But the copy is as large as the file, up to `maxFileSize`, in a worker, for each of the two workers, against [ADR 0004](0004-video-limits.md)'s rule that a file's size costs time and not memory. It would also still need this reader to find the frames.
- **A virtual MP4 over the original bytes,** an index made in memory whose sample offsets point into the DHAV file: no copy, but MP4 samples are length-prefixed and DHAV's are Annex B, so every read would rewrite bytes behind mediabunny's back, through a source other than `BlobSource`, which ADR 0001 forbids.
- **Converting Annex B to length-prefixed samples with `avcC` and `hvcC` records, without mediabunny:** what an MP4 file gives a decoder. Every engine in the matrix decodes Annex B directly, so it would be a copy of every picture and two more record writers for nothing.
- **FFmpeg compiled to WebAssembly:** rejected in ADR 0001 for its licence, its size and its CSP, and no less so for one more container.
- **Keeping the recorder's gaps on the timeline:** truthful to the clock, but it makes long empty stretches in an editor whose purpose is cutting to the event, and breaks the sound's sync.
- **Trusting the header's codec, size and frame rate:** less code than parsing parameter sets, but the limits would then be checked against what a header claims, which ADR 0001 rules out.

## Consequences

- **A `.dav` file opens, plays, trims and exports like any other source,** in every engine that decodes its codecs: H.264 everywhere, HEVC where the browser has it.
- **No new dependency, no WebAssembly, and nothing in the main entries.** The reader is in the two worker chunks, a few kilobytes each.
- **The SDK now owns a container parser and two parameter-set parsers.** They're small, about 600 lines, but they're hostile-input code that the fuzz corpus must keep covering.
- **Opening reads the whole file once,** because the format has no index: about as long as the file takes to read, and again for each open and each worker. The index itself is small.
- **It's proved on generated files only.** A recorder may write something this reader refuses: a frame without its trailer, sound in a codec it doesn't play, or tags it doesn't know. Each fails or degrades with a named reason rather than a guess. What real recordings show is fixed in later changes, each with a generated fixture of the same shape.
- **A recording's gaps and its wall-clock times are gone from the timeline.** A host that needs the time of day of a frame can't get it from this SDK.
- **An outage shorter than half a second in both tracks is kept in the picture and closed in the sound,** so the sound runs early by that much afterwards. That's ADR 0001's existing cost for a gap in a source's audio, and the threshold keeps it small.
- **Not done here:** AAC and the other named codecs, sample aspect ratios, and more than one channel from a file.
