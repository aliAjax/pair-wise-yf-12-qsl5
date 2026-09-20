// 本地持久化：网点记录与排程分别存储，互不影响。
// 仅负责序列化/反序列化与简单的结构迁移，不承载排程规则与状态流转。

import type { RecordItem } from "../station";
import type { Schedule } from "./types";

const STATION_KEY = "hxwlfront-21-station-map";
const SCHEDULE_KEY = "hxwlfront-21-schedules";
const DATA_VERSION = 2;

export const STATION_CAPACITY_DEFAULT = 50000;

function readJSON<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 兼容旧数据：补齐油罐容量字段 */
export function migrateStation(record: RecordItem): RecordItem {
  if (typeof record.capacity !== "number" || !Number.isFinite(record.capacity)) {
    const stock = Number(record.stock) || 0;
    record.capacity = Math.max(STATION_CAPACITY_DEFAULT, Math.ceil((stock * 1.5) / 1000) * 1000);
  }
  if (record.status === "卸油中") {
    // 异常遗留（旧版本不存在该状态）：重置为营业中，由排程重新驱动
    record.status = "营业中";
  }
  return record;
}

export function loadStations(seed: () => RecordItem[]): RecordItem[] {
  const data = readJSON<RecordItem[] | { version: number; records: RecordItem[] }>(STATION_KEY);
  if (!data) return seed();
  const list = Array.isArray(data) ? data : data.records ?? [];
  return list.map((item) => migrateStation({ ...item }));
}

export function saveStations(records: RecordItem[]): void {
  localStorage.setItem(STATION_KEY, JSON.stringify({ version: DATA_VERSION, records }));
}

export function loadSchedules(): Schedule[] {
  const data = readJSON<Schedule[] | { version: number; records: Schedule[] }>(SCHEDULE_KEY);
  if (!data) return [];
  return (Array.isArray(data) ? data : data.records ?? []) as Schedule[];
}

export function saveSchedules(schedules: Schedule[]): void {
  localStorage.setItem(SCHEDULE_KEY, JSON.stringify({ version: DATA_VERSION, records: schedules }));
}
