import { afterEach, expect, test, vi } from "vitest";
import { callClaude, setMessagesClientForTests, TaskBudgetExceeded } from "../../../convex/node/claude";

afterEach(() => { setMessagesClientForTests(null); vi.useRealTimers(); });

test("a stalled provider call aborts at 60 seconds; retries renew the lease and respect the task deadline", async () => {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  const heartbeat = vi.fn(async () => {});
  setMessagesClientForTests({ create: async (_params, options) => {
    expect(options!.timeout).toBeLessThanOrEqual(60_000);
    signals.push(options!.signal);
    return new Promise(() => {});
  } });
  const request = callClaude({ system: "Test", messages: [{ role: "user", content: "Test" }], effort: "low", deadlineAt: Date.now() + 61_000, beforeAttempt: heartbeat });
  const result = expect(request).rejects.toBeInstanceOf(TaskBudgetExceeded);
  await vi.advanceTimersByTimeAsync(61_000);
  await result;
  expect(heartbeat).toHaveBeenCalledTimes(2);
  expect(signals).toHaveLength(2);
  expect(signals.every(signal => signal.aborted)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
