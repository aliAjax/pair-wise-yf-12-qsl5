/**
 * 本地持久化：统一 localStorage 读写，键由调用方传入。
 * 业务层不直接碰 localStorage，便于后续替换为接口。
 */

export function load<T>(key: string, fallback: () => T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback();
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback();
  }
}

export function save<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}
