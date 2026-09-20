// 排程规则：纯函数承载，与状态流转、本地持久化解耦
// 规则：
// 1. 油罐编号、到站窗口（起/止）、卸油量、当前库存均必填；
// 2. 同一罐车（油罐编号相同）到站窗口重叠即整批拒绝；
// 3. 卸油后库存 = 当前库存 + 卸油量，超过油罐容量即整批拒绝；
// 4. 整批提交：任何一行不合法，整批拒绝，原排程、库存和状态都不变。

import type { BatchDraftRow, Schedule, SchedulableStation } from "./types";

export interface NormalizedRow {
  stationId: string;
  tankNo: string;
  windowStart: string;
  windowEnd: string;
  unloadAmount: number;
  currentStock: number;
}

export interface ValidationResult {
  ok: boolean;
  /** 错误信息，定位到具体行号（从 1 起）/罐号 */
  errors: string[];
  rows?: NormalizedRow[];
}

/** 半开区间 [start, end) 是否重叠；端点相接不算重叠 */
export function windowsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function normalizeDraft(
  drafts: BatchDraftRow[],
  stationMap: Map<string, SchedulableStation>
): { rows: NormalizedRow[]; errors: string[] } {
  const errors: string[] = [];
  const rows: NormalizedRow[] = [];

  drafts.forEach((draft, index) => {
    const line = `第${index + 1}行`;
    const rowErrors: string[] = [];

    const stationId = String(draft.stationId || "").trim();
    const tankNo = String(draft.tankNo || "").trim();
    const startRaw = String(draft.windowStart || "").trim();
    const endRaw = String(draft.windowEnd || "").trim();
    const unload = Number(draft.unloadAmount);
    const stock = Number(draft.currentStock);

    if (!stationId) rowErrors.push(`${line}：请选择油站`);
    else if (!stationMap.has(stationId)) rowErrors.push(`${line}：油站不存在`);
    if (!tankNo) rowErrors.push(`${line}：油罐编号必填`);
    if (!startRaw || !endRaw) rowErrors.push(`${line}：到站窗口起止必填`);
    if (draft.unloadAmount === "" || draft.unloadAmount === null || !Number.isFinite(unload) || unload <= 0) {
      rowErrors.push(`${line}：卸油量必须为大于 0 的数字`);
    }
    if (draft.currentStock === "" || draft.currentStock === null || !Number.isFinite(stock) || stock < 0) {
      rowErrors.push(`${line}：当前库存必须为不小于 0 的数字`);
    }

    let windowStart = "";
    let windowEnd = "";
    if (startRaw && endRaw) {
      const startMs = new Date(startRaw).getTime();
      const endMs = new Date(endRaw).getTime();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        rowErrors.push(`${line}：到站窗口时间格式无效`);
      } else {
        windowStart = new Date(startMs).toISOString();
        windowEnd = new Date(endMs).toISOString();
        if (startMs >= endMs) rowErrors.push(`${line}：到站窗口开始时间必须早于结束时间`);
      }
    }

    errors.push(...rowErrors);
    if (rowErrors.length === 0) {
      rows.push({ stationId, tankNo, windowStart, windowEnd, unloadAmount: unload, currentStock: stock });
    }
  });

  return { rows, errors };
}

/**
 * 校验一整批排程草稿。
 * @param drafts 表单草稿行
 * @param stations 当前可排程油站（提供容量等信息）
 * @param existing 已存在的排程（待到站 / 卸油中 仍占用窗口）
 */
export function validateBatch(
  drafts: BatchDraftRow[],
  stations: SchedulableStation[],
  existing: Schedule[]
): ValidationResult {
  if (drafts.length === 0) {
    return { ok: false, errors: ["请至少添加一行排程"] };
  }

  const stationMap = new Map(stations.map((s) => [s.id, s]));
  const { rows, errors } = normalizeDraft(drafts, stationMap);
  if (errors.length > 0) return { ok: false, errors };

  // 规则 2：同一罐车窗口重叠（批内自查 + 与既有未完成排程比对）
  const occupied = existing
    .filter((item) => item.status !== "已完成")
    .map((item) => ({
      tankNo: item.tankNo,
      start: new Date(item.windowStart).getTime(),
      end: new Date(item.windowEnd).getTime(),
      label: `既有排程 ${item.tankNo}（${item.stationName}）`
    }));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const start = new Date(row.windowStart).getTime();
    const end = new Date(row.windowEnd).getTime();

    for (const other of occupied) {
      if (other.tankNo === row.tankNo && windowsOverlap(start, end, other.start, other.end)) {
        errors.push(`第${i + 1}行：罐车 ${row.tankNo} 与${other.label}到站窗口重叠`);
      }
    }

    for (let j = 0; j < i; j++) {
      const prev = rows[j];
      if (
        prev.tankNo === row.tankNo &&
        windowsOverlap(
          new Date(prev.windowStart).getTime(),
          new Date(prev.windowEnd).getTime(),
          start,
          end
        )
      ) {
        errors.push(`第${j + 1}行与第${i + 1}行：罐车 ${row.tankNo} 到站窗口重叠`);
      }
    }
  }

  // 规则 3：卸油后超过油罐容量
  // 同一油站批内多行时逐行累加到模拟库存；另叠加该站未完成排程的计划卸油量
  const pendingByStation = new Map<string, number>();
  for (const item of existing) {
    if (item.status !== "已完成") {
      pendingByStation.set(
        item.stationId,
        (pendingByStation.get(item.stationId) ?? 0) + item.unloadAmount
      );
    }
  }
  // 以油站当前真实库存为基准：既有未完成排程将来也会入库，需一并预占容量
  const projectedStock = new Map<string, number>();
  for (const station of stations) {
    projectedStock.set(
      station.id,
      (station.stock as number) + (pendingByStation.get(station.id) ?? 0)
    );
  }

  // 草稿行的“当前库存”作为操作员确认值参与一致性校验，容量判定以系统最新库存 + 预占为准
  rows.forEach((row, index) => {
    const station = stationMap.get(row.stationId)!;
    if (Math.abs(row.currentStock - (station.stock as number)) > 0.001) {
      errors.push(
        `第${index + 1}行：当前库存与系统库存（${station.stock}L）不一致，请刷新后重试`
      );
    }
    const base = projectedStock.get(row.stationId) ?? (station.stock as number);
    const after = base + row.unloadAmount;
    if (after > station.capacity) {
      errors.push(
        `第${index + 1}行：${station.station}卸油后库存 ${after}L 超过油罐容量 ${station.capacity}L`
      );
    }
    projectedStock.set(row.stationId, after);
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, errors: [], rows };
}
