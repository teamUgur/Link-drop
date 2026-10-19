import {BusyError} from "../errors.ts";

type Waiter = { resolve: (release: () => void) => void; reject: (e: unknown) => void; signal?: AbortSignal; onAbort?: () => void };

// Свой семафор вместо p-limit: нужна ограниченная очередь с быстрым отказом (BUSY) и отмена
// ожидания по AbortSignal, когда клиент ушёл, пока стоял в очереди.
export class Semaphore {
    private readonly limit: number;
    private readonly queueLimit: number;
    private readonly retryAfterSec: number;
    private active = 0;
    private readonly queue: Waiter[] = [];

    constructor(limit: number, queueLimit: number, retryAfterSec = 30) {
        this.limit = limit;
        this.queueLimit = queueLimit;
        this.retryAfterSec = retryAfterSec;
    }

    get activeCount(): number {
        return this.active;
    }

    get queuedCount(): number {
        return this.queue.length;
    }

    acquire(signal?: AbortSignal): Promise<() => void> {
        if (signal?.aborted) return Promise.reject(signal.reason);
        if (this.active < this.limit) {
            this.active++;
            return Promise.resolve(this.releaser());
        }
        if (this.queue.length >= this.queueLimit) {
            return Promise.reject(new BusyError(this.retryAfterSec));
        }
        return new Promise((resolve, reject) => {
            const waiter: Waiter = {resolve, reject};
            if (signal) {
                waiter.signal = signal;
                waiter.onAbort = () => {
                    const i = this.queue.indexOf(waiter);
                    if (i !== -1) this.queue.splice(i, 1);
                    reject(signal.reason);
                };
                signal.addEventListener("abort", waiter.onAbort, {once: true});
            }
            this.queue.push(waiter);
        });
    }

    async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        const release = await this.acquire(signal);
        try {
            return await fn();
        } finally {
            release();
        }
    }

    private releaser(): () => void {
        let released = false;
        // Повторный release не должен раздувать счётчик — иначе потолок молча растёт.
        return () => {
            if (released) return;
            released = true;
            const next = this.queue.shift();
            if (next) {
                if (next.signal && next.onAbort) next.signal.removeEventListener("abort", next.onAbort);
                next.resolve(this.releaser());
            } else {
                this.active--;
            }
        };
    }
}
