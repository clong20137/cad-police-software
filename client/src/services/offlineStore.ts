type OfflineRecord<T> = {
  key: string;
  value: T;
  savedAt: number;
  size: number;
};

const DB_NAME = 'blueline-cad-offline';
const DB_VERSION = 1;
const STORE_NAME = 'records';
const FALLBACK_PREFIX = 'cad_offline_v2:';
const MAX_RECORDS = 32;
const MAX_TOTAL_CHARS = 3_000_000;

class OfflineStore {
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  async get<T>(key: string): Promise<OfflineRecord<T> | null> {
    const db = await this.openDb();
    if (!db) return this.getFallback<T>(key);

    return new Promise((resolve) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as OfflineRecord<T> | undefined) || null);
      request.onerror = () => resolve(this.getFallback<T>(key));
    });
  }

  async set<T>(key: string, value: T): Promise<void> {
    const record: OfflineRecord<T> = {
      key,
      value,
      savedAt: Date.now(),
      size: this.safeStringify(value).length
    };
    const db = await this.openDb();
    if (!db) {
      this.setFallback(record);
      return;
    }

    await new Promise<void>((resolve) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => {
        this.setFallback(record);
        resolve();
      };
    });
    await this.prune();
  }

  async removePrefix(prefix: string): Promise<void> {
    const db = await this.openDb();
    if (!db) {
      this.removeFallbackPrefix(prefix);
      return;
    }
    const records = await this.entries();
    await Promise.all(records.filter((record) => record.key.startsWith(prefix)).map((record) => this.delete(record.key)));
    this.removeFallbackPrefix(prefix);
  }

  async entries(): Promise<Array<OfflineRecord<unknown>>> {
    const db = await this.openDb();
    if (!db) return this.fallbackEntries();

    return new Promise((resolve) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as Array<OfflineRecord<unknown>>) || []);
      request.onerror = () => resolve(this.fallbackEntries());
    });
  }

  private async delete(key: string): Promise<void> {
    const db = await this.openDb();
    if (!db) {
      localStorage.removeItem(`${FALLBACK_PREFIX}${key}`);
      return;
    }
    await new Promise<void>((resolve) => {
      const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
    localStorage.removeItem(`${FALLBACK_PREFIX}${key}`);
  }

  private async prune(): Promise<void> {
    const records = (await this.entries()).sort((first, second) => first.savedAt - second.savedAt);
    let totalSize = records.reduce((sum, record) => sum + record.size, 0);
    while (records.length > 0 && (records.length > MAX_RECORDS || totalSize > MAX_TOTAL_CHARS)) {
      const oldest = records.shift();
      if (!oldest) break;
      totalSize -= oldest.size;
      await this.delete(oldest.key);
    }
  }

  private openDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return this.dbPromise;
  }

  private getFallback<T>(key: string): OfflineRecord<T> | null {
    try {
      const stored = localStorage.getItem(`${FALLBACK_PREFIX}${key}`);
      return stored ? (JSON.parse(stored) as OfflineRecord<T>) : null;
    } catch {
      return null;
    }
  }

  private setFallback<T>(record: OfflineRecord<T>): void {
    try {
      localStorage.setItem(`${FALLBACK_PREFIX}${record.key}`, JSON.stringify(record));
      this.pruneFallback();
    } catch {
      this.pruneFallback(true);
    }
  }

  private fallbackEntries(): Array<OfflineRecord<unknown>> {
    const records: Array<OfflineRecord<unknown>> = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(FALLBACK_PREFIX)) continue;
      try {
        records.push(JSON.parse(localStorage.getItem(key) || '{}') as OfflineRecord<unknown>);
      } catch {
        localStorage.removeItem(key);
      }
    }
    return records;
  }

  private pruneFallback(force = false): void {
    const records = this.fallbackEntries().sort((first, second) => first.savedAt - second.savedAt);
    let totalSize = records.reduce((sum, record) => sum + record.size, 0);
    while (records.length > 0 && (force || records.length > MAX_RECORDS || totalSize > MAX_TOTAL_CHARS)) {
      const oldest = records.shift();
      if (!oldest) break;
      localStorage.removeItem(`${FALLBACK_PREFIX}${oldest.key}`);
      totalSize -= oldest.size;
      force = false;
    }
  }

  private removeFallbackPrefix(prefix: string): void {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(`${FALLBACK_PREFIX}${prefix}`)) {
        localStorage.removeItem(key);
      }
    }
  }

  private safeStringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
}

export const offlineStore = new OfflineStore();
export type { OfflineRecord };
