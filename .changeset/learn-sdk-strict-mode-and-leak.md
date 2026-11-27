---
"@hussmartinez/learn-sdk": patch
---

`LearnPlayer` keeps saving under React's `StrictMode`, and every import from the core is about 1.2 kB smaller.

- **`StrictMode`:** in development, `StrictMode` runs effects twice. `LearnPlayer` disposed its session in the first run's cleanup and kept using it, so answers showed as checked and never reached `progressStore` or `onProgress`'s saves. Production builds weren't affected. The session now lives as long as the component listens to it, as `useLearnPlayer`'s does.
- **Size:** the message catalogue, the limit definitions and two constants no longer ride along with unrelated imports. `import { parseContent }` goes from 3.1 to 1.9 kB, `gradeAnswer` from 2.6 to 1.4 kB, and `defaultLanguageProfile` from 1.5 to 0.07 kB, minified and compressed. Nothing changes in the API.
