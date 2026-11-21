---
"@hussmartinez/sdk-config": patch
---

`importBudget` and `hm-size` no longer risk measuring an import too small. To find the names a bundle imports and never uses, they read the bundle as JavaScript, which it is, instead of as TypeScript.

Read as TypeScript, `limit<maximum>(strict || 1)` is a call with a type argument rather than two comparisons, so a name used only in the middle of such an expression looked unused and was cut from the measurement. A floor that measures too small hides the leaks it exists to catch. It needed that exact shape in a minified bundle, so no budget is known to have been affected, and you have nothing to change.
