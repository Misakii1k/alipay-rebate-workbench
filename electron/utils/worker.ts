import path from "node:path";
import { availableParallelism, totalmem } from "node:os";
import { Worker } from "node:worker_threads";

export interface WorkerProgress {
  phase: string;
  scanned?: number;
  currentDir?: string;
  elapsedMs?: number;
}

export interface WorkerEnvelope<T> {
  ok: boolean;
  result?: T;
  error?: string;
  progress?: WorkerProgress;
  requestId?: string;
}

export interface WorkerTaskOptions {
  requestId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface QueuedWorkerTask {
  run: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  cleanupQueuedAbort?: () => void;
}

interface WorkerQueueState {
  active: number;
  pending: QueuedWorkerTask[];
}

const ONE_GB = 1024 * 1024 * 1024;
const WORKER_LIMITS: Record<string, number> = {
  reviewIndexWorker: 1,
  thumbnailWorker: 1,
  videoIndexWorker: 1
};
const workerQueues = new Map<string, WorkerQueueState>();
let activeWorkerCount = 0;

function computeGlobalWorkerLimit(): number {
  const cores = Math.max(1, availableParallelism?.() ?? 2);
  const memoryGb = totalmem() / ONE_GB;
  if (cores <= 4 || memoryGb <= 8) return 1;
  if (cores <= 6 || memoryGb <= 12) return 2;
  return 3;
}

const GLOBAL_WORKER_LIMIT = computeGlobalWorkerLimit();

function workerLimit(workerName: string): number {
  return WORKER_LIMITS[workerName] ?? Math.min(2, GLOBAL_WORKER_LIMIT);
}

function workerQueue(workerName: string): WorkerQueueState {
  let state = workerQueues.get(workerName);
  if (!state) {
    state = { active: 0, pending: [] };
    workerQueues.set(workerName, state);
  }
  return state;
}

function scheduleWorkerQueues(): void {
  if (activeWorkerCount >= GLOBAL_WORKER_LIMIT) return;
  for (const [workerName, state] of workerQueues) {
    const limit = workerLimit(workerName);
    while (activeWorkerCount < GLOBAL_WORKER_LIMIT && state.active < limit && state.pending.length) {
      const task = state.pending.shift();
      if (!task) break;
      task.cleanupQueuedAbort?.();
      if (task.signal?.aborted) {
        task.reject(new Error(`${workerName} worker aborted before start`));
        continue;
      }
      state.active += 1;
      activeWorkerCount += 1;
      task.run();
    }
    if (activeWorkerCount >= GLOBAL_WORKER_LIMIT) return;
  }
}

export function getWorkerQueueStats() {
  return {
    globalLimit: GLOBAL_WORKER_LIMIT,
    active: activeWorkerCount,
    workers: Array.from(workerQueues.entries()).map(([name, state]) => ({
      name,
      active: state.active,
      pending: state.pending.length,
      limit: workerLimit(name)
    }))
  };
}

export function workerScriptPath(name: string): string {
  return path.join(__dirname, "..", "workers", `${name}.js`);
}

export function runWorkerTask<TPayload, TResult>(
  workerName: string,
  payload: TPayload,
  onProgress?: (progress: WorkerProgress) => void,
  options: WorkerTaskOptions = {}
): Promise<TResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error(`${workerName} worker aborted before queue`));
      return;
    }

    const queue = workerQueue(workerName);
    const task: QueuedWorkerTask = {
      signal: options.signal,
      reject,
      run: () => {
        startWorkerTask<TPayload, TResult>(workerName, payload, onProgress, options)
          .then(resolve, reject)
          .finally(() => {
            const state = workerQueue(workerName);
            state.active = Math.max(0, state.active - 1);
            activeWorkerCount = Math.max(0, activeWorkerCount - 1);
            scheduleWorkerQueues();
          });
      }
    };

    if (options.signal) {
      const abortQueued = () => {
        const index = queue.pending.indexOf(task);
        if (index === -1) return;
        queue.pending.splice(index, 1);
        task.cleanupQueuedAbort?.();
        reject(new Error(`${workerName} worker aborted before start`));
        scheduleWorkerQueues();
      };
      task.cleanupQueuedAbort = () => options.signal?.removeEventListener("abort", abortQueued);
      options.signal.addEventListener("abort", abortQueued, { once: true });
    }

    queue.pending.push(task);
    scheduleWorkerQueues();
  });
}

function startWorkerTask<TPayload, TResult>(
  workerName: string,
  payload: TPayload,
  onProgress?: (progress: WorkerProgress) => void,
  options: WorkerTaskOptions = {}
): Promise<TResult> {
  return new Promise((resolve, reject) => {
    const workerData = options.requestId ? { ...(payload as object), requestId: options.requestId } : payload;
    const worker = new Worker(workerScriptPath(workerName), { workerData });
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const terminateWith = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      void worker.terminate().finally(() => reject(error));
    };

    const onAbort = () => terminateWith(new Error(`${workerName} worker aborted`));

    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => terminateWith(new Error(`${workerName} worker timed out after ${options.timeoutMs}ms`)), options.timeoutMs);
    }
    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    worker.on("message", (message: WorkerEnvelope<TResult>) => {
      if (options.requestId && message.requestId !== options.requestId) return;
      if (message.progress) {
        onProgress?.(message.progress);
        return;
      }
      finish(() => {
        if (message.ok) resolve(message.result as TResult);
        else reject(new Error(message.error || `${workerName} worker failed`));
      });
    });

    worker.on("error", (error) => {
      finish(() => reject(error));
    });

    worker.on("exit", (code) => {
      if (settled || code === 0) return;
      finish(() => reject(new Error(`${workerName} worker exited with code ${code}`)));
    });
  });
}
