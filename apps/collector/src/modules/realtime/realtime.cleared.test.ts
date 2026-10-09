import { describe, expect, it, vi } from "vitest";
import { RealtimeStore } from "./realtime.store.js";

describe("RealtimeStore.onCleared", () => {
  it("notifies listeners when persisted deltas are dropped", () => {
    const store = new RealtimeStore();
    const listener = vi.fn();
    store.onCleared(listener);

    store.clearTraffic(7);
    store.clearCountries(7);
    store.clearTrafficSummary(8);

    expect(listener).toHaveBeenCalledWith(7);
    expect(listener).toHaveBeenCalledWith(8);
    expect(listener.mock.calls.every(([id]) => id === 7 || id === 8)).toBe(true);
  });

  it("stops notifying after unsubscribe and survives a throwing listener", () => {
    const store = new RealtimeStore();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    store.onCleared(bad);
    const off = store.onCleared(good);

    store.clearTraffic(1);
    expect(good).toHaveBeenCalled();
    off();
    good.mockClear();
    store.clearTraffic(1);
    expect(good).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
