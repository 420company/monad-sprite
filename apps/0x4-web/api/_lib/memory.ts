/**
 * Per-wallet persistent memory for the agent.
 *
 * In-memory on serverless (resets on cold start). On the VPS product this
 * becomes SQLite. The agent uses save_memory/recall_memory tools; relevant
 * memories are injected into the system prompt on each request.
 */

export interface MemoryEntry {
  key: string;
  value: string;
  updatedAt: number;
}

// wallet -> key -> entry
const store = new Map<string, Map<string, MemoryEntry>>();

const MAX_PER_WALLET = 100;

export function saveMemory(wallet: string, key: string, value: string): void {
  const w = wallet.toLowerCase();
  let m = store.get(w);
  if (!m) {
    m = new Map();
    store.set(w, m);
  }
  if (m.size >= MAX_PER_WALLET && !m.has(key.toLowerCase())) {
    // evict oldest
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [k, v] of m) {
      if (v.updatedAt < oldestTs) {
        oldestTs = v.updatedAt;
        oldestKey = k;
      }
    }
    if (oldestKey) m.delete(oldestKey);
  }
  m.set(key.toLowerCase().slice(0, 100), {
    key: key.slice(0, 100),
    value: value.slice(0, 2000),
    updatedAt: Date.now(),
  });
}

export function recallMemory(wallet: string, query?: string): MemoryEntry[] {
  const m = store.get(wallet.toLowerCase());
  if (!m) return [];
  const all = [...m.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  if (!query) return all.slice(0, 20);
  const q = query.toLowerCase();
  return all.filter((e) => e.key.includes(q) || e.value.toLowerCase().includes(q)).slice(0, 10);
}

export function deleteMemory(wallet: string, key: string): boolean {
  return store.get(wallet.toLowerCase())?.delete(key.toLowerCase()) ?? false;
}

/** Format memories for system prompt injection */
export function formatMemoriesForPrompt(wallet: string): string {
  const entries = recallMemory(wallet);
  if (entries.length === 0) return '';
  const lines = entries.map((e) => `- ${e.key}: ${e.value}`);
  return `\n\nWhat you remember about this user (from past conversations):\n${lines.join('\n')}\nUse this naturally — don't recite it back unless relevant.`;
}
