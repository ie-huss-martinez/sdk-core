---
"@hussmartinez/sdk-core": patch
---

Add `cleanFileName(raw)` and `MAX_FILE_NAME_LENGTH`, the family's one way to clean a file's name (ADR 0051). A name is chosen by whoever made the file, so it's hostile input like the bytes: it can hold a path, control characters, a right-to-left override that disguises an extension, or thousands of characters.

```ts
import { cleanFileName } from "@hussmartinez/sdk-core";

cleanFileName("C:\\Users\\me\\report.pdf"); // "report.pdf"
cleanFileName("invoice\u202Efdp.exe");       // "invoicefdp.exe"
cleanFileName("../..");                      // undefined
```

The result is one path segment of well-formed Unicode in NFC, without control or bidirectional formatting characters, without `< > : " | ? *`, without leading dots or whitespace at either end, and at most 128 code points. It's safe as text content and as a download's name; it isn't escaped for markup or URLs.

These are pdf-sdk's rules, which audio-sdk and video-sdk copied, with one addition: unpaired surrogates are removed. If your SDK has a copy, replace it with this import.
