---
"@hussmartinez/sdk-core": patch
---

Add error text by reason, and `messages.warning()` (ADR 0050).

- **`messages.error(error)` looks for `errors.<CODE>.<reason>` first,** when the error's `details.reason` is a string and the catalogue has that key, with `details` as its parameters. Otherwise it uses `errors.<CODE>`, then `errors.UNKNOWN`, as before. So one code can have a sentence for each cause, such as `"errors.UNSUPPORTED_ENVIRONMENT.autoplay-blocked"`, and hosts can override each one. Nothing changes for a catalogue without such keys.
- **`messages.warning(warning)` gives a warning's text.** `{ type: "limit", limit, actual }` gets `warnings.<limit>`, and any other `{ type }` gets `warnings.<type>`, with the warning's own fields as parameters. A limit or type the catalogue has no text for is a type error; at run time it renders as its key, like `t()`. The new types are `MessageWarning<Catalogue>` and `WarningName<Catalogue>`.

```ts
messages.error(new AudioError("DURATION_TOO_LONG", "…", { details: { reason: "plan-too-long", actual } }));
for (const warning of snapshot.warnings) announce(messages.warning(warning));
```

This is additive: existing calls keep working. `Messages` has a new member, though, so an object you wrote by hand and typed as `Messages`, such as a test double, needs a `warning` method. Objects from `createMessages` already have it.
