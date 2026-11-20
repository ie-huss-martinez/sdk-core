---
"@hussmartinez/sdk-core": patch
---

Fix a worker call that could never be cancelled when its signal aborted while the worker was being created. `call()` checked the signal before calling `createWorker`, and listened for `abort` afterwards, so a `createWorker` that aborted the call's own signal slipped between the two: the call was sent to the worker, and no `cancel` followed. `call()` now checks the signal again once the worker exists, rejects with `ABORTED` (or `TIMEOUT`, or the signal's `SdkError` reason) and sends nothing. The worker that was created stays for the next call. Nothing changes for callers whose `createWorker` only creates a worker.
