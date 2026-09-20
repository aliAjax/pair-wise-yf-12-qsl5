// 排程状态流转：待到站 -> 卸油中 -> 已完成
// - 到站（arrive）：油站置为「卸油中」，油站状态锁定，不能进行常规流转；
// - 完成卸油（complete）：油站恢复「营业中」，库存按实收量增加；
// - 已到站未完成期间，油站不能被重复到站、不能删除/改库存。

import type { Schedule } from "./types";

export const UNLOADING_STATUS = "卸油中";
export const OPEN_STATUS = "营业中";

/** 流转所需的油站字段 */
export interface FlowStation {
  id: string;
  stock: number;
  capacity: number;
  status: string;
  [key: string]: string | number | undefined;
}

export interface FlowResult<TStation extends FlowStation> {
  ok: boolean;
  message: string;
  schedules: Schedule[];
  stations: TStation[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 是否有排程正处于卸油中（到站后未完成） */
export function findUnloading(stationId: string, schedules: Schedule[]): Schedule | undefined {
  return schedules.find((item) => item.stationId === stationId && item.status === "卸油中");
}

/** 油站是否锁定（卸油中不可流转、不可删除） */
export function isStationLocked(stationId: string, schedules: Schedule[]): boolean {
  return Boolean(findUnloading(stationId, schedules));
}

/**
 * 到站：待到站 -> 卸油中，同时锁定油站状态。
 * 纯函数：返回全新数组，不修改入参；失败时返回的结果与原数据一致。
 */
export function arrive<TStation extends FlowStation>(
  schedules: Schedule[],
  stations: TStation[],
  id: string
): FlowResult<TStation> {
  const target = schedules.find((item) => item.id === id);
  if (!target) return fail(schedules, stations, "排程不存在");
  if (target.status !== "待到站") return fail(schedules, stations, "仅待到站排程可以到站");
  if (findUnloading(target.stationId, schedules)) {
    return fail(schedules, stations, "该油站已有罐车正在卸油");
  }
  const station = stations.find((s) => s.id === target.stationId);
  if (!station) return fail(schedules, stations, "油站不存在或已删除");

  const now = new Date().toISOString();
  const nextSchedules = clone(schedules);
  const nextStations = clone(stations);
  const schedule = nextSchedules.find((item) => item.id === id)!;
  schedule.status = "卸油中";
  schedule.arrivedAt = now;
  const s = nextStations.find((item) => item.id === target.stationId)!;
  s.status = UNLOADING_STATUS;

  return { ok: true, message: "已到站，油站进入卸油中", schedules: nextSchedules, stations: nextStations };
}

/**
 * 完成卸油：卸油中 -> 已完成，油站恢复营业，库存按实收量更新。
 * 实收量必填且大于 0；实收后同样不得超过油罐容量。
 */
export function complete<TStation extends FlowStation>(
  schedules: Schedule[],
  stations: TStation[],
  id: string,
  actualAmount: number
): FlowResult<TStation> {
  const target = schedules.find((item) => item.id === id);
  if (!target) return fail(schedules, stations, "排程不存在");
  if (target.status !== "卸油中") return fail(schedules, stations, "仅卸油中的排程可以完成卸油");
  if (!Number.isFinite(actualAmount) || actualAmount <= 0) {
    return fail(schedules, stations, "实收卸油量必须为大于 0 的数字");
  }
  const station = stations.find((s) => s.id === target.stationId);
  if (!station) return fail(schedules, stations, "油站不存在或已删除");

  const after = Number(station.stock) + actualAmount;
  if (after > station.capacity) {
    return fail(schedules, stations, `实收后库存 ${after}L 超过油罐容量 ${station.capacity}L，无法完成`);
  }

  const now = new Date().toISOString();
  const nextSchedules = clone(schedules);
  const nextStations = clone(stations);
  const schedule = nextSchedules.find((item) => item.id === id)!;
  schedule.status = "已完成";
  schedule.actualAmount = actualAmount;
  schedule.completedAt = now;
  const s = nextStations.find((item) => item.id === target.stationId)!;
  s.stock = after;
  s.status = OPEN_STATUS;

  return { ok: true, message: `卸油完成，实收 ${actualAmount}L，库存更新为 ${after}L`, schedules: nextSchedules, stations: nextStations };
}

function fail<TStation extends FlowStation>(
  schedules: Schedule[],
  stations: TStation[],
  message: string
): FlowResult<TStation> {
  return { ok: false, message, schedules, stations };
}
