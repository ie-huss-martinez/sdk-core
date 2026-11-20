# 0050. Error text by reason, and text for warnings

- **Status:** Accepted
- **Date:** 2026-11-21
- **Refines:** [ADR 0019](0019-message-catalogues.md)'s error lookup, by adding a more specific key ahead of `errors.<CODE>`, and its `warnings.<LIMIT>` keys, by giving them a lookup of their own

## Context

[ADR 0019](0019-message-catalogues.md) finds an error's text under `errors.<CODE>`, with the error's `details` as parameters, and says only that warnings use `warnings.<LIMIT>` keys. Two gaps have appeared since, and `audio-sdk` and `video-sdk` each closed both with a copy of the same two functions ([audio-sdk#54](https://github.com/ie-huss-martinez/audio-sdk/issues/54), points 9 and 12; [audio-sdk#66](https://github.com/ie-huss-martinez/audio-sdk/pull/66) proposes moving them here).

**One code can need more than one text.** `UNSUPPORTED_ENVIRONMENT` says "This browser doesn't support a feature this tool needs", which is wrong when `play()` was refused because the browser blocks sound until the user presses Play. `DURATION_TOO_LONG` on a file the user opened and on an edit that would make the recording too long need different sentences. A new code for each case would multiply codes that hosts handle the same way. [ADR 0045](0045-portable-formats-and-conformance-vectors.md) already gives rejections a stable `details.reason` token beside the code, so the distinction exists in the error; only the text lookup ignores it. `audioErrorText` and `videoErrorText` look up `errors.<CODE>.<reason>` first.

**Warnings have no lookup.** A session's warnings share one shape across the family: `{ type: "limit", limit, actual }` for a value at or above a limit's warning threshold ([ADR 0020](0020-file-policy.md)), and `{ type: <other>, … }` for anything else, such as a truncated recording. The limit's name is known only at run time, so `messages.t()` can't type the key, and every UI widens the type by hand. `audioWarningText` and `videoWarningText` do it once per SDK.

Image and PDF editors will need both. Four copies would drift, and hosts would learn four function names for one thing.

## Decision

### `messages.error()` looks for the reason's text first

For an `SdkError`, `messages.error(error)` uses the first of these keys that the catalogue has, with the error's `details` as parameters:

1. **`errors.<CODE>.<reason>`,** when `details.reason` is a string;
2. **`errors.<CODE>`,** as before;
3. **`errors.UNKNOWN`,** as before, which any value that isn't an `SdkError` gets too.

- **A reason without text falls back to its code's text.** So an SDK words only the reasons that need their own sentence, and a new reason never makes an error unreadable.
- **The reason is read as an own property of `details`,** and a reason that isn't a string is ignored.
- **Reasons are stable tokens,** as [ADR 0045](0045-portable-formats-and-conformance-vectors.md) requires, such as `plan-too-long`. Codes contain no dots, so `errors.<CODE>.<reason>` can't be mistaken for another code's key.
- **These are ordinary catalogue keys.** Hosts override the text for one reason through `messages`, with the placeholders its English text has, and the override checks of ADR 0019 apply unchanged.
- **Each SDK decides which reasons must have text,** with a `satisfies` check on its catalogue, as it does for its codes. `sdk-core` has no reason texts of its own.

### `messages.warning()` gives a warning's text

`Messages` gains `warning(warning)`, for the family's warning shape, with the warning's own fields as parameters:

- **`{ type: "limit", limit, actual }`** gets `warnings.<limit>`;
- **any other `{ type }`** gets `warnings.<type>`.

- **The shape is now a family rule.** An SDK's warning type is a union of these two forms. Further fields, such as the `source` a warning is about, are allowed.
- **Types check that the text exists.** The parameter's type, `MessageWarning<Catalogue>`, accepts a limit or type only when the catalogue has its `warnings.` key. An SDK's whole warning type is accepted when every limit and every type in it has text, so a missing text fails the SDK's type check rather than reaching a user.
- **A type can't be named `limit`,** which is taken by the first form.
- **It never throws,** like `t()`: at run time, a warning without text renders as its key, with a development-only warning.

### What SDKs do

- **New code uses `messages.error()` and `messages.warning()`.** No SDK adds a text helper of its own.
- **`audio-sdk` and `video-sdk` deprecate `audioErrorText`, `audioWarningText`, `videoErrorText` and `videoWarningText`** once they depend on this release, keep them as one-line calls to `messages` until their next breaking release, and remove them then.

## Alternatives considered

- **A code for each case, such as `AUTOPLAY_BLOCKED`:** it needs no lookup change, but hosts that branch on the code would have to learn each new one, and conformance vectors already compare a code and a reason.
- **Standalone functions, `errorText(messages, error)` and `warningText(messages, warning)`:** they'd leave `Messages` unchanged, but `messages.error()` would then give the less specific text, and callers would have to know to avoid it.
- **`warning()` taking only the limit's name and value:** it wouldn't cover warnings that aren't limits, which both SDKs with warnings already have.
- **A fallback text, `warnings.UNKNOWN`:** an error can come from anywhere, so it needs one; a warning is created by the SDK that owns the catalogue, and the types already require its text. A vague sentence would hide the missing one.
- **Passing only `{ actual }` to a limit's text:** it's all today's texts use, but the warning's other fields cost nothing to pass, and translators can only use placeholders the English text has.

## Consequences

- An error's text can say why it happened, without new codes, and hosts can translate each reason.
- One call gives a warning's text in every SDK, and a warning without text is a type error.
- `Messages` has a new member. Code that receives a `Messages` object is unaffected; a hand-written object typed as `Messages`, such as a test double, must add `warning`.
- `details.reason` now selects text, so renaming a reason changes what users read. ADR 0045 already makes reasons stable.
- `audio-sdk` and `video-sdk` each have four exports to deprecate and later remove.
