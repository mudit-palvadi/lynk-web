const STORAGE_KEY = "lynk-history";
export const MAX_RECORDS = 20;

function sanitize(record) {
  const { aesKey: _k, link: _l, wrappedKey: _w, ...clean } = record;
  return {
    id: String(clean.id ?? ""),
    type: clean.type === "received" ? "received" : "sent",
    fileNames: Array.isArray(clean.fileNames) ? clean.fileNames.map(String) : [],
    totalSize: Number(clean.totalSize) || 0,
    timestamp: Number(clean.timestamp) || Date.now(),
    status: String(clean.status ?? "completed"),
  };
}

export class HistoryStore {
  #storage;

  constructor({ storage } = {}) {
    this.#storage = storage ?? globalThis.sessionStorage;
  }

  add(record) {
    const records = [sanitize(record), ...this.list()];
    const pruned = records.slice(0, MAX_RECORDS);
    this.#storage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  }

  list() {
    let parsed;
    try {
      parsed = JSON.parse(this.#storage.getItem(STORAGE_KEY) ?? "[]");
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r) => r && typeof r === "object" && typeof r.id === "string",
    );
  }

  clear() {
    this.#storage.removeItem(STORAGE_KEY);
  }
}
