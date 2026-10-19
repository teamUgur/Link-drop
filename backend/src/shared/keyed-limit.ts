// Не больше max операций на ключ одновременно (ключ — сессия браузера или IP). Без очереди:
// лишний запрос получает отказ сразу, ждать за самим собой клиенту незачем.
export class KeyedLimit {
    private readonly max: number;
    private readonly counts = new Map<string, number>();

    constructor(max: number) {
        this.max = max;
    }

    // undefined — у ключа уже max операций. Освобождение идемпотентно: его зовут из нескольких
    // веток завершения, и повтор не должен уводить счётчик в минус.
    tryAcquire(key: string): (() => void) | undefined {
        const count = this.counts.get(key) ?? 0;
        if (count >= this.max) return undefined;
        this.counts.set(key, count + 1);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const left = (this.counts.get(key) ?? 1) - 1;
            // Пустые ключи удаляем, иначе Map копит все IP за время жизни процесса.
            if (left <= 0) this.counts.delete(key);
            else this.counts.set(key, left);
        };
    }

    get size(): number {
        return this.counts.size;
    }
}
