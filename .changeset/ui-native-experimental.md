---
"@hussmartinez/ui": patch
---

`@hussmartinez/ui/native` is marked experimental in the README: it hasn't been checked on a device, or with VoiceOver and TalkBack, yet. Until it has, its API may change in any release.

`createNativeTheme` checks a curve's length before copying it, so an array of the wrong length is refused at once, however long it is.
