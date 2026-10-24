export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

export class MemoryStore implements KeyValueStore {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  keys() { return [...this.m.keys()]; }
}

/** localStorage when available (it can throw in private modes), memory otherwise. */
export function browserStore(): KeyValueStore {
  try {
    const t = '__fluent_probe__';
    window.localStorage.setItem(t, '1'); window.localStorage.removeItem(t);
    const ls = window.localStorage;
    return {
      getItem: (k) => ls.getItem(k), setItem: (k, v) => ls.setItem(k, v), removeItem: (k) => ls.removeItem(k),
      keys: () => Array.from({ length: ls.length }, (_, i) => ls.key(i)!).filter(Boolean),
    };
  } catch { return new MemoryStore(); }
}
