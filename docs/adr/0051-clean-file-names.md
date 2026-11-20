# 0051. Clean file names once, with `cleanFileName`

- **Status:** Accepted
- **Date:** 2026-11-21
- **Refines:** [ADR 0012](0012-hostile-input-and-no-network.md), by treating a file's name as hostile input in the same way as its bytes, and giving every SDK one implementation

## Context

[ADR 0012](0012-hostile-input-and-no-network.md) treats every file as hostile, and keeps file names and contents out of usage events. It says nothing else about a file's name. Editors show the name of what's open and use it for the download, so the name reaches the screen and the user's disk. Whoever made the file chose it, and it can hold:

- path separators, as in `../../etc/passwd` or `C:\Users\me\report.pdf`;
- control characters, including line breaks;
- bidirectional formatting characters that disguise an extension: `invoice\u202Efdp.exe` is shown as `invoiceexe.pdf`;
- characters some systems refuse in file names;
- half a surrogate pair, which isn't text;
- thousands of characters.

`pdf-sdk` decided how to clean a name in its [ADR 0009](https://github.com/ie-huss-martinez/pdf-sdk/blob/main/docs/adr/0009-saving-the-document.md). `audio-sdk` and `video-sdk` then copied its `cleanFileName` and its tests, each with a comment that it "moves to sdk-core once that has it". `image-sdk` will need a fourth for its download names. A security rule kept as copies drifts, and a fix to one copy doesn't reach the others.

## Decision

### `sdk-core` exports `cleanFileName(raw)` and `MAX_FILE_NAME_LENGTH`

`cleanFileName` takes any value and returns the clean name, or `undefined` when the value isn't a string or nothing is left. It applies `pdf-sdk`'s rules, in this order:

1. **Remove characters that aren't printable text:** control characters (Unicode category Cc: C0, DEL and C1), unpaired surrogates, and the bidirectional formatting characters U+061C, U+200E, U+200F, U+202A–U+202E and U+2066–U+2069.
2. **Keep only the last segment** after a `/` or `\`, so no path survives.
3. **Remove the characters Windows refuses** in file names: `< > : " | ? *`.
4. **Normalise to NFC,** after the removals, which can leave a base letter beside its combining mark.
5. **Trim whitespace and leading dots,** so a name can't be hidden or look empty.
6. **Cap it at 128 code points,** `MAX_FILE_NAME_LENGTH`, never splitting a surrogate pair, and trim whitespace the cap exposes at the end.
7. **If nothing is left, there's no name.**

Cleaning is stable: a clean name is returned unchanged.

**One rule is new here: unpaired surrogates are removed.** The copies kept them. A name with one isn't well-formed Unicode: it shows as a replacement character, changes when encoded as UTF-8, and makes `encodeURIComponent` throw. Every other name is cleaned exactly as the copies clean it.

### How SDKs use it

- **Clean once, where the name enters the SDK,** such as when a source is registered from `File.name` or a `name` option. Only the clean name is stored or exposed, so no later use can forget to clean it.
- **A name from the host is cleaned the same way,** such as a `downloadName` or `fileName` prop's value.
- **A clean name is text, not markup:** it's only ever text content, or a download's file name. It's never HTML, never an attribute that's parsed (`href`, `src`, `style`), and never part of a URL. The function doesn't escape for any of those.
- **It never reaches `onEvent`** ([ADR 0012](0012-hostile-input-and-no-network.md)). Each SDK has a test that opens files with distinctive names and asserts that no event contains them.
- **Extensions and fallbacks stay in each SDK.** What a download is called when there's no name ("document.pdf", "recording"), and which extension it gets, depend on the kind. An SDK that adds an extension keeps the result within `MAX_FILE_NAME_LENGTH`.

### Adoption

`pdf-sdk`, `audio-sdk` and `video-sdk` replace their copies with the import, and delete the copies and their tests. `pdf-sdk`'s ADR 0009 stays as the record of its download tool, and refers here for the name's rules.

## Alternatives considered

- **Leaving each SDK its copy:** no dependency on a release of `sdk-core`, but three copies already exist, and the rule is a security control that must be the same everywhere.
- **Keeping the raw name and cleaning it where it's used:** every use would have to remember. One clean value, made once, can't be misused later.
- **Refusing a hostile name with an error:** a file with an odd name is still a file the user wants to open. Cleaning loses nothing they need.
- **Replacing removed characters with `_`:** it keeps the name's length, but a disguised name would still look odd rather than plain, and a name made only of refused characters would become a row of underscores instead of no name.
- **Also handling Windows' reserved device names (`CON`, `NUL`, `COM1`) and trailing dots:** browsers already rewrite those when saving a download, and they're harmless as text. The rules stay those that matter in both places a name goes.
- **A helper that also adds the extension and a fallback:** the SDKs' rules differ (PDF keeps `.pdf`; audio and video strip the source's extension and add the export's), so it would be configuration around three lines of code.

## Consequences

- One implementation and one test suite, including a property test over arbitrary strings, for a rule that guards the screen and the disk.
- A name is cleaned the same in every editor, so a file keeps one name across them.
- Three SDKs delete a copy each. Until they do, their copies differ from this one only for names with unpaired surrogates.
- `sdk-core`'s headless entry grows by one small function.
