/**
 * 油罐车到站排程规则。
 * 纯函数承载整批校验：任一规则不满足即整批拒绝，调用方保证不落任何状态。
 */

import type { Station } from "./stationFlow";

export type ScheduleStatus = "待到站" | "卸油中" | "已完成";

export const SCHEDULE_STATUSES: ScheduleStatus[] = ["待到站", "卸油中", "已完成"];

/** 排程表单一行的输入 */
export interface ScheduleRowInput {
  stationId: string;
  tankerId: string;
  windowStart: string;
  windowEnd: string;
  plannedVolume: number;
  currentStock: number;
}

/** 落库后的排程记录 */
export interface Schedule extends ScheduleRowInput {
  id: string;
  batchId: string;
  status: ScheduleStatus;
  actualVolume: number | null;
  createdAt: string;
}

/** 两个到站窗口是否重叠（半开区间 [start, end)） */
export function windowsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);
}

/** 未完成的排程仍占用罐车与库容 */
export function isActive(schedule: Schedule): boolean {
  return schedule.status !== "已完成";
}

export type BatchValidation = {
  ok: boolean;
  errors: string[];
};

/**
 * 整批校验：
 * 1. 必填与取值合法（油罐编号、到站窗口、卸油量、当前库存）；
 * 2. 同一罐车的窗口不得重叠（批内互查 + 与既有未完成排程互查）；
 * 3. 卸油后不得超过油罐容量（当前库存 + 在途计划 + 本批计划 <= 容量）。
 */
export function validateBatch(
  rows: ScheduleRowInput[],
  stations: Station[],
  existing: Schedule[]
): BatchValidation {
  const errors: string[] = [];

  if (rows.length === 0) {
    errors.push("排程不能为空，请至少添加一站");
  }

  rows.forEach((row, index) => {
    const label = `第 ${index + 1} 行`;
    if (!row.stationId) errors.push(`${label}：请选择油站`);
    if (!row.tankerId.trim()) errors.push(`${label}：油罐编号必填`);
    if (!row.windowStart || !row.windowEnd) {
      errors.push(`${label}：到站窗口必填`);
    } else if (Date.parse(row.windowStart) >= Date.parse(row.windowEnd)) {
      errors.push(`${label}：到站窗口开始必须早于结束`);
    }
    if (!Number.isFinite(row.plannedVolume) || row.plannedVolume <= 0) {
      errors.push(`${label}：卸油量必填且必须大于 0`);
    }
    if (!Number.isFinite(row.currentStock) || row.currentStock < 0) {
      errors.push(`${label}：当前库存必填且不能为负`);
    }
  });

  const active = existing.filter(isActive);

  // 同一罐车窗口重叠：批内互查
  rows.forEach((row, i) => {
    rows.slice(i + 1).forEach((other, j) => {
      if (
        row.tankerId.trim() &&
        row.tankerId.trim() === other.tankerId.trim() &&
        windowsOverlap(row.windowStart, row.windowEnd, other.windowStart, other.windowEnd)
      ) {
        errors.push(`油罐车「${row.tankerId.trim()}」第 ${i + 1} 行与第 ${i + j + 2} 行的到站窗口重叠`);
      }
    });
  });

  // 同一罐车窗口重叠：与既有未完成排程互查
  rows.forEach((row, i) => {
    const tanker = row.tankerId.trim();
    if (!tanker) return;
    active
      .filter((schedule) => schedule.tankerId === tanker)
      .forEach((schedule) => {
        if (windowsOverlap(row.windowStart, row.windowEnd, schedule.windowStart, schedule.windowEnd)) {
          errors.push(`油罐车「${tanker}」第 ${i + 1} 行与既有排程的到站窗口重叠`);
        }
      });
  });

  // 容量：按油站汇总本批计划
  const byStation = new Map<string, ScheduleRowInput[]>();
  rows.forEach((row) => {
    if (!row.stationId) return;
    const list = byStation.get(row.stationId) ?? [];
    list.push(row);
    byStation.set(row.stationId, list);
  });

  byStation.forEach((stationRows, stationId) => {
    const station = stations.find((item) => item.id === stationId);
    if (!station) {
      errors.push(`所选油站不存在，请刷新后重试`);
      return;
    }
    const declared = stationRows[0].currentStock;
    if (stationRows.some((row) => row.currentStock !== declared)) {
      errors.push(`油站「${station.station}」同批排程登记的当前库存不一致`);
      return;
    }
    const committed = active
      .filter((schedule) => schedule.stationId === stationId)
      .reduce((sum, schedule) => sum + schedule.plannedVolume, 0);
    const incoming = stationRows.reduce((sum, row) => sum + row.plannedVolume, 0);
    const after = declared + committed + incoming;
    if (after > station.capacity) {
      errors.push(
        `油站「${station.station}」卸油后预计 ${after}L，超过油罐容量 ${station.capacity}L（库存 ${declared}L + 在途 ${committed}L + 本批 ${incoming}L）`
      );
    }
  });

  return { ok: errors.length === 0, errors };
}

/** 校验通过后把整批行展开为待到站排程；调用方必须先确认 validateBatch 通过 */
export function buildSchedules(rows: ScheduleRowInput[], batchId: string): Schedule[] {
  const createdAt = new Date().toISOString();
  return rows.map((row) => ({
    ...row,
    tankerId: row.tankerId.trim(),
    id: crypto.randomUUID(),
    batchId,
    status: "待到站",
    actualVolume: null,
    createdAt
  }));
}
