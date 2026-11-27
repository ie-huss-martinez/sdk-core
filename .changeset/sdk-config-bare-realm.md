---
"@hussmartinez/sdk-config": patch
---

Add `runInBareRealm`, from the new entry `@hussmartinez/sdk-config/testing/bare-realm`: it bundles a built entry whole and runs a probe on its exports in a realm with the ECMAScript language and nothing else, with no `Intl`, no `String.prototype.normalize` and no browser or Node globals. It's the check that a package's `.` or `./native` entry is safe on Hermes, React Native's engine. `stubs` replaces packages such as `react-native`, and `provided` names the globals React Native itself sets up. It needs `esbuild`.
