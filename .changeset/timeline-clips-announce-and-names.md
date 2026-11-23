---
"@hussmartinez/ui": patch
---

**`TimelineClips` announces a clip added to the selection or taken out of it,** with Space or a Ctrl- or ⌘-click, as "Shot 2, selected" or "Shot 2, not selected". Screen readers don't say that a focused option's selection changed, so this was silent before. The announcement goes through the closest `AnnouncerProvider`, after you render the new `selectedKeys`; a change you refuse isn't announced. Two new messages word it, `timelineClips.selected` and `timelineClips.notSelected`, each with a `{label}`. Translate them with your other overrides.

**A clip's `label` should leave out its place.** The clips are a listbox, and screen readers say an option's place themselves, "2 of 5", so a label such as "Clip 2 of 5, 0:04.00 to 0:09.20" was heard with its place twice. The docs and examples now name a clip by what it shows and its range: "Clip 2, 0:04.00 to 0:09.20". Drop "of {count}" from your own labels.
