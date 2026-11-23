---
"@hussmartinez/audio-sdk": patch
---

A clip's name in the timeline leaves out its place: "Clip 2 on Music, 0:04.00 to 0:09.20" rather than "Clip 2 of 5 on Music, 0:04.00 to 0:09.20". Screen readers say an option's place in the clip list themselves, so it was heard twice. `timeline.clip`, `timeline.clip.named`, `timeline.clip.gain` and `timeline.clip.named.gain` still receive `count`, as plural messages selected by it, so an override that says "of {count}" keeps working and type-checking. A host whose override repeats the count may want to drop it.

The editor's message catalogue also has two more keys from ui's `TimelineClips`, `timelineClips.selected` and `timelineClips.notSelected`. Override them with your other translations.
