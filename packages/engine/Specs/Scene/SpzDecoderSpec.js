import SpzDecoder from "../../Source/Scene/SpzDecoder.js";

describe("Scene/SpzDecoder", function () {
  const slots = SpzDecoder._slots;
  let pending;
  beforeEach(function () {
    pending = [];
    const schedule = (parameters, transfers) =>
      new Promise((resolve, reject) =>
        pending.push({ parameters, transfers, resolve, reject }),
      );
    for (const slot of slots) {
      slot.processor?.destroy();
      slot.busy = false;
      const worker = new EventTarget();
      slot.processor = {
        _worker: worker,
        destroy: jasmine.createSpy("destroy"),
        scheduleTask: jasmine.createSpy("scheduleTask").and.callFake(schedule),
      };
    }
  });
  afterEach(function () {
    for (const slot of slots) {
      slot.processor?.destroy();
      slot.processor = undefined;
      slot.busy = false;
    }
  });

  it("bounds active work and retries without queuing or detaching shared input", async function () {
    const shared = new Uint8Array([9, 1, 2, 8]);
    const tasks = slots.map(() => SpzDecoder.decode(shared.subarray(1, 3), 3));
    expect(SpzDecoder.decode(shared)).toBeUndefined();
    expect(pending.length).toBe(slots.length);
    for (const job of pending) {
      expect(job.parameters.array).toEqual(new Uint8Array([1, 2]));
      expect(job.parameters.array.buffer).not.toBe(shared.buffer);
      expect(job.transfers).toEqual([job.parameters.array.buffer]);
      expect(job.parameters.packedDegree).toBe(3);
    }
    expect(shared).toEqual(new Uint8Array([9, 1, 2, 8]));
    pending[0].resolve({ gcloud: { numPoints: 1 } });
    await tasks[0];
    const retry = SpzDecoder.decode(shared);
    expect(retry).toBeDefined();
    for (const job of pending) {
      job.resolve({ gcloud: { numPoints: 1 } });
    }
    await Promise.all([...tasks, retry]);
    expect(slots.every((slot) => !slot.busy)).toBe(true);
  });

  it("releases a failed slot and destroys its processor", async function () {
    const processor = slots[0].processor;
    const task = SpzDecoder.decode(new Uint8Array([1]));
    pending[0].reject(new Error("bad SPZ"));
    await expectAsync(task).toBeRejectedWithError("bad SPZ");
    expect(processor.destroy).toHaveBeenCalled();
    expect(slots[0].processor).toBeUndefined();
    expect(slots[0].busy).toBe(false);
  });

  ["error", "messageerror"].forEach(function (eventName) {
    it(`rejects a worker ${eventName} without leaving its slot busy`, async function () {
      const processor = slots[0].processor;
      const task = SpzDecoder.decode(new Uint8Array([1]));
      processor._worker.dispatchEvent(new Event(eventName));
      await expectAsync(task).toBeRejected();
      expect(processor.destroy).toHaveBeenCalled();
      expect(slots[0].processor).toBeUndefined();
      expect(slots[0].busy).toBe(false);
      pending[0].resolve({});
    });
  });

  it("releases admission when posting throws", async function () {
    const processor = slots[0].processor;
    processor.scheduleTask.and.throwError("cannot post");
    await expectAsync(
      SpzDecoder.decode(new Uint8Array([1])),
    ).toBeRejectedWithError("cannot post");
    expect(processor.destroy).toHaveBeenCalled();
    expect(slots[0].busy).toBe(false);
  });
});
