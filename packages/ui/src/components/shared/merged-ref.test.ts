import { describe, expect, it, vi } from "vitest";
import { forwardingRef } from "./merged-ref.js";

const node = { id: "button" };

describe("forwardingRef", () => {
  it("under React 19, runs the host's cleanup on detach instead of calling it with null", () => {
    const hostCleanup = vi.fn();
    const host = vi.fn((_: typeof node | null) => hostCleanup);
    const own = vi.fn();
    const cleanup = forwardingRef(host, own)(node);
    expect(host).toHaveBeenCalledWith(node);
    expect(own).toHaveBeenLastCalledWith(node);
    // React 19 calls the returned cleanup when the element detaches.
    cleanup?.();
    expect(hostCleanup).toHaveBeenCalledOnce();
    expect(host).not.toHaveBeenCalledWith(null);
    expect(own).toHaveBeenLastCalledWith(null);
  });

  it("under React 19, gives a host's callback without a cleanup null on detach", () => {
    const host = vi.fn();
    const own = vi.fn();
    forwardingRef(host, own)(node)?.();
    expect(host.mock.calls).toEqual([[node], [null]]);
    expect(own).toHaveBeenLastCalledWith(null);
  });

  it("under React 18, which ignores the cleanup, gives both null when called with null", () => {
    const host = vi.fn();
    const own = vi.fn();
    const ref = forwardingRef(host, own);
    ref(node);
    ref(null);
    expect(host.mock.calls).toEqual([[node], [null]]);
    expect(own.mock.calls).toEqual([[node], [null]]);
  });

  it("sets and clears an object ref", () => {
    const host = { current: null as typeof node | null };
    const own = vi.fn();
    const cleanup = forwardingRef(host, own)(node);
    expect(host.current).toBe(node);
    cleanup?.();
    expect(host.current).toBeNull();
    expect(own).toHaveBeenLastCalledWith(null);
  });
});
