---
"@hussmartinez/sdk-core": patch
---

Every import of `@hussmartinez/sdk-core` is about 0.1 kB smaller in an application's bundle.

Two values at the top level of the package were kept by bundlers in every import, used or not, because a bundler couldn't tell that creating them has no side effects: the set of key names that shortcuts accept, whose function keys were spread in from a call, and a default size written as `1 << 20`. The key names are now written out and the size is a plain number, so both are dropped unless you import what uses them.

Importing only `SdkError` goes from 284 B to 168 B, and `MAX_FILE_NAME_LENGTH` from 0.16 kB to 0.03 kB, compressed. Nothing changes in the API or in behaviour. If your package has an import budget whose scenario includes sdk-core's code, it reads a little lower.
