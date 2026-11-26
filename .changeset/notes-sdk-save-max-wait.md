---
"@hussmartinez/notes-sdk": patch
---

Steady writing is now saved at least every 2 seconds. Before, each change restarted the 400 ms save delay, so a notebook written on without a pause stayed unsaved until the writing stopped, and closing the tab could lose it. The first unsaved change is now saved within 2 s, or within `saveDelay` when a host sets a longer one. Nothing changes in the API.
