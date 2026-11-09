// @vitest-environment node
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  runPython,
  stopPython,
  resetPython,
  isPythonWarmed,
  getQueueStatus,
  setWorkerFactoryForTest,
  type PyResult,
} from "../site/lib/pyRunner";

class MockWorker {
  onmessage: ((e: MessageEvent<{ id: number } & Omit<PyResult, "ms">>) => void) | null = null;
  onerror: ((e: ErrorEvent | Error) => void) | null = null;
  terminated = false;
  postedMessages: Array<{
    id: number;
    code: string;
    tests?: string;
    stdin?: string;
    files?: Record<string, string>;
  }> = [];

  postMessage(data: any) {
    this.postedMessages.push(data);
  }

  terminate() {
    this.terminated = true;
  }

  reply(data: { id: number; ok: boolean; phase?: "load" | "code" | "tests" | "timeout" | "stopped"; stdout: string; error?: string }) {
    if (this.onmessage) {
      this.onmessage({ data } as MessageEvent<any>);
    }
  }

  emitError(err: Error | ErrorEvent) {
    if (this.onerror) {
      this.onerror(err);
    }
  }
}

describe("Python Worker Queue, Watchdog & Lifecycle Architecture", () => {
  let activeWorkers: MockWorker[] = [];

  beforeEach(() => {
    activeWorkers = [];
    resetPython();
    setWorkerFactoryForTest(() => {
      const w = new MockWorker();
      activeWorkers.push(w);
      return w as unknown as Worker;
    });
  });

  afterEach(() => {
    resetPython();
    setWorkerFactoryForTest(null);
  });

  it("1. handles two sequential requests smoothly", async () => {
    const p1 = runPython("print('first')");
    expect(activeWorkers.length).toBe(1);
    expect(activeWorkers[0].postedMessages.length).toBe(1);
    const req1Id = activeWorkers[0].postedMessages[0].id;

    // Worker completes first run
    activeWorkers[0].reply({ id: req1Id, ok: true, stdout: "first\n" });
    const res1 = await p1;

    expect(res1.ok).toBe(true);
    expect(res1.stdout).toBe("first\n");
    expect(isPythonWarmed()).toBe(true);

    // Second run issued sequentially
    const p2 = runPython("print('second')");
    expect(activeWorkers[0].postedMessages.length).toBe(2);
    const req2Id = activeWorkers[0].postedMessages[1].id;

    activeWorkers[0].reply({ id: req2Id, ok: true, stdout: "second\n" });
    const res2 = await p2;

    expect(res2.ok).toBe(true);
    expect(res2.stdout).toBe("second\n");
  });

  it("2. queues multiple rapid requests and only runs the active one with timeout", async () => {
    // Send 3 requests synchronously
    const p1 = runPython("req1");
    const p2 = runPython("req2");
    const p3 = runPython("req3");

    const w = activeWorkers[0];
    // Only the FIRST request must be posted to the worker; queued requests wait on main thread
    expect(w.postedMessages.length).toBe(1);
    expect(w.postedMessages[0].code).toBe("req1");

    const status1 = getQueueStatus();
    expect(status1.isRunning).toBe(true);
    expect(status1.queuedCount).toBe(2);

    // Resolve req1
    w.reply({ id: w.postedMessages[0].id, ok: true, stdout: "out1\n" });
    const res1 = await p1;
    expect(res1.stdout).toBe("out1\n");

    // Once req1 completes, req2 is immediately pumped to the worker
    expect(w.postedMessages.length).toBe(2);
    expect(w.postedMessages[1].code).toBe("req2");
    expect(getQueueStatus().queuedCount).toBe(1);

    // Resolve req2
    w.reply({ id: w.postedMessages[1].id, ok: true, stdout: "out2\n" });
    const res2 = await p2;
    expect(res2.stdout).toBe("out2\n");

    // Once req2 completes, req3 is pumped
    expect(w.postedMessages.length).toBe(3);
    expect(w.postedMessages[2].code).toBe("req3");
    expect(getQueueStatus().queuedCount).toBe(0);

    // Resolve req3
    w.reply({ id: w.postedMessages[2].id, ok: true, stdout: "out3\n" });
    const res3 = await p3;
    expect(res3.stdout).toBe("out3\n");
  });

  it("3. handles first request timing out while another is queued without hanging", async () => {
    // Req 1 has a short 50ms timeout; req 2 is queued behind it
    const p1 = runPython("while True: pass", undefined, 50);
    const p2 = runPython("print('queued')");

    const w = activeWorkers[0];
    expect(w.postedMessages.length).toBe(1);
    expect(getQueueStatus().queuedCount).toBe(1);

    // Worker hangs on req1 and does not reply
    // Wait for timeout to fire
    await new Promise((r) => setTimeout(r, 80));

    const res1 = await p1;
    expect(res1.ok).toBe(false);
    expect(res1.phase).toBe("timeout");
    expect(res1.error).toContain("check for an infinite loop");
    expect(w.terminated).toBe(true);

    // The queued request is cleanly settled as cancelled/stopped, never hangs
    const res2 = await p2;
    expect(res2.ok).toBe(false);
    expect(res2.phase).toBe("stopped");
    expect(res2.error).toContain("worker was terminated");
    expect(getQueueStatus().queuedCount).toBe(0);
    expect(getQueueStatus().isRunning).toBe(false);
  });

  it("4. stopPython() cleanly terminates worker and settles active and queued runs", async () => {
    const p1 = runPython("import time; time.sleep(10)");
    const p2 = runPython("print('waiting')");

    const w = activeWorkers[0];
    expect(getQueueStatus().isRunning).toBe(true);
    expect(getQueueStatus().queuedCount).toBe(1);

    stopPython();

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.ok).toBe(false);
    expect(res1.phase).toBe("stopped");
    expect(res1.error).toBe("Stopped.");

    expect(res2.ok).toBe(false);
    expect(res2.phase).toBe("stopped");
    expect(w.terminated).toBe(true);
    expect(getQueueStatus().isRunning).toBe(false);
    expect(getQueueStatus().queuedCount).toBe(0);
  });

  it("5. resetPython() cleanly settles pending runs and marks interpreter unwarmed", async () => {
    // Warm interpreter first
    const p0 = runPython("x = 1");
    activeWorkers[0].reply({ id: activeWorkers[0].postedMessages[0].id, ok: true, stdout: "" });
    await p0;
    expect(isPythonWarmed()).toBe(true);

    const p1 = runPython("calc()");
    const p2 = runPython("calc2()");

    resetPython("Manual reset triggered");

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.ok).toBe(false);
    expect(res1.phase).toBe("stopped");
    expect(res1.error).toBe("Manual reset triggered");

    expect(res2.ok).toBe(false);
    expect(res2.phase).toBe("stopped");

    expect(isPythonWarmed()).toBe(false);
    expect(activeWorkers[0].terminated).toBe(true);
  });

  it("6. handles worker initialization failure followed by successful retry", async () => {
    const p1 = runPython("print('try1')");
    const w1 = activeWorkers[0];

    // Worker reports initialization / package failure under phase 'load'
    w1.reply({
      id: w1.postedMessages[0].id,
      ok: false,
      phase: "load",
      stdout: "",
      error: "Python could not start: failed to download wasm module",
    });

    const res1 = await p1;
    expect(res1.ok).toBe(false);
    expect(res1.phase).toBe("load");
    expect(res1.error).toContain("Python could not start");
    expect(isPythonWarmed()).toBe(false);

    // Second run: retry succeeds
    const p2 = runPython("print('retry')");
    const w2 = activeWorkers[activeWorkers.length - 1];
    w2.reply({
      id: w2.postedMessages[w2.postedMessages.length - 1].id,
      ok: true,
      stdout: "retry\n",
    });

    const res2 = await p2;
    expect(res2.ok).toBe(true);
    expect(res2.stdout).toBe("retry\n");
    expect(isPythonWarmed()).toBe(true);
  });

  it("7. recovers successfully after timeout and executes subsequent commands cleanly", async () => {
    // 1. Timeout run
    const p1 = runPython("infinite_loop()", undefined, 40);
    const w1 = activeWorkers[0];
    await new Promise((r) => setTimeout(r, 60));

    const res1 = await p1;
    expect(res1.ok).toBe(false);
    expect(res1.phase).toBe("timeout");
    expect(w1.terminated).toBe(true);

    // 2. Next run after timeout: creates fresh worker and succeeds
    const p2 = runPython("print('healthy after timeout')");
    expect(activeWorkers.length).toBe(2);
    const w2 = activeWorkers[1];
    expect(w2.terminated).toBe(false);

    w2.reply({
      id: w2.postedMessages[0].id,
      ok: true,
      stdout: "healthy after timeout\n",
    });

    const res2 = await p2;
    expect(res2.ok).toBe(true);
    expect(res2.stdout).toBe("healthy after timeout\n");
  });
});

