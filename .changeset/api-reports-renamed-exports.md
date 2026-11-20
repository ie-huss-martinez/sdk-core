---
"@hussmartinez/sdk-config": patch
---

Fix `hm-check-api-reports` flagging types that share a name with a global. API Extractor renames such a type in every report: an SDK's `AudioSampleFormat` (also a WebCodecs type) or `Scheduler` (also a DOM type) appears in the main report as `export { AudioSampleFormat_2 as AudioSampleFormat }`, and other entry points' reports refer to `AudioSampleFormat_2`. The command read only the name after `as`, so it failed with `"AudioSampleFormat_2" is copied from the package, but the main entry point doesn't export it.`

It now counts both names as exported, with the kind of the declaration behind them. So a renamed class is still checked for `private`, `protected` and `#private` members, under the name the declaration rollup gives it.

Nothing to change in your repository: update `@hussmartinez/sdk-config` and remove any workaround, such as a type renamed only to avoid the clash.
