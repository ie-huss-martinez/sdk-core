---
"@hussmartinez/video-sdk": patch
---

A clip's name in the timeline leaves out its place: "Clip 2, 0:04.00 to 0:09.20" rather than "Clip 2 of 5, 0:04.00 to 0:09.20". Screen readers say an option's place in the clip list themselves, so it was heard twice. `timeline.clip` and `timeline.clipMuted` still receive `count`, as plural messages selected by it, so an override that says "of {count}" keeps working and type-checking. A host whose override repeats the count may want to drop it.

The editor's message catalogue also has two more keys from ui's `TimelineClips`, `timelineClips.selected` and `timelineClips.notSelected`: Space or a Ctrl- or ⌘-click on a clip now announces "Clip 2, 0:04.00 to 0:09.20, not selected". Override them with your other translations.
