import { afterEach, describe, expect, it, vi } from "vitest";
import { lockName, whileLocked } from "./locks.js";

// On Node's own Web Locks, and with them taken away.

describe("whileLocked", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Runs two pieces of work under one name, and says what each was told and in which order. */
  async function twoUnder(name: string): Promise<{ told: boolean[]; order: string[] }> {
    const told: boolean[] = [];
    const order: string[] = [];
    let finish: () => void = () => {};
    const untilFinished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const first = whileLocked(name, async (acrossTabs) => {
      told.push(acrossTabs);
      order.push("first began");
      await untilFinished;
      order.push("first ended");
    });
    const second = whileLocked(name, async (acrossTabs) => {
      told.push(acrossTabs);
      order.push("second began");
      return "done";
    });
    // Free under another name, so it can run while the first is still at work.
    await whileLocked(`${name}-other`, async () => {
      order.push("other ran");
    });
    finish();
    await first;
    await expect(second).resolves.toBe("done");
    return { told, order };
  }

  const inTurn = ["first began", "other ran", "first ended", "second began"];

  it("runs one piece of work at a time, and tells it that other tabs are kept out", async () => {
    expect(navigator.locks).toBeDefined();
    const { told, order } = await twoUnder(lockName("locks-test", "file", "with"));
    expect(order).toEqual(inTurn);
    expect(told).toEqual([true, true]);
  });

  it("still runs one at a time without the Web Locks API, and says other tabs aren't kept out", async () => {
    vi.stubGlobal("navigator", {});
    const { told, order } = await twoUnder(lockName("locks-test", "file", "without"));
    expect(order).toEqual(inTurn);
    expect(told).toEqual([false, false]);
  });

  it("gives the name to the next piece of work when one fails", async () => {
    const failure = new Error("The work gave up.");
    for (const navigatorStub of [undefined, {}]) {
      if (navigatorStub) vi.stubGlobal("navigator", navigatorStub);
      const name = lockName("locks-test", "file", navigatorStub ? "failing-without" : "failing");
      await expect(
        whileLocked(name, async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      await expect(whileLocked(name, async () => "next")).resolves.toBe("next");
    }
  });
});
