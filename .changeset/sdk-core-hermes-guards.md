---
"@hussmartinez/sdk-core": patch
---

`createMessages` and `cleanFileName` work on engines with little or no `Intl` and no `String.prototype.normalize`, such as Hermes in React Native.

- **`createMessages`:** plain text and placeholders given text need no `Intl`. A plural, a number, or a placeholder with a format, such as `{size, fileSize}`, checks for the `Intl` constructor it needs first. Where it's missing, `t()` throws an `SdkError` with the code `UNSUPPORTED_ENVIRONMENT` and `details.feature` naming it, such as `Intl.PluralRules`, where it used to throw a `TypeError`. Where the engine can't canonicalise a locale, a well-formed tag is used as given.
- **`cleanFileName`:** without `normalize`, the name keeps the form it came in. Everything else is cleaned as before.

Nothing changes in browsers or Node, which have all of these.
