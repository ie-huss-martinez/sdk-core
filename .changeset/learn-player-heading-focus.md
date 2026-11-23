---
"@hussmartinez/learn-sdk": patch
---

The player's exercise heading takes focus only when the player moves focus to it, after Next or Previous, and can't take it once focus leaves. Before, it could always take focus, so NVDA's first Tab into the player landed on the heading instead of the first choice, and Enter there did nothing. Focus after Next is unchanged.
