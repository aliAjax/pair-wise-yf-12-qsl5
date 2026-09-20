// 油罐车到站排程：类型定义

export type ScheduleStatus = "待到站" | "卸油中" | "已完成";

export const SCHEDULE_STATUSES: readonly ScheduleStatus[] = ["待到站", "卸油中", "已完成"];

/** 可参与排程的油站最小信息（由网点记录适配） */
export interface SchedulableStation {
  id: string;
  station: string;
  stock: number;
  capacity: number;
  status: string;
  area?: string | number;
  [key: string]: string | number | undefined;
}

/** 已落库的排程单 */
export interface Schedule {
  id: string;
  batchId: string;
  stationId: string;
  stationName: string;
  tankNo: string;
  windowStart: string; // ISO 时间
  windowEnd: string; // ISO 时间
  unloadAmount: number; // 计划卸油量 L
  currentStock: number; // 排程时确认的当前库存 L
  actualAmount?: number; // 实收卸油量 L，完成卸油时填写
  status: ScheduleStatus;
  createdAt: string;
  arrivedAt?: string;
  completedAt?: string;
}

/** 批量排程表单中的一行（输入态，数字/时间可能是字符串，提交时统一校验转换） */
export interface BatchDraftRow {
  stationId: string;
  tankNo: string;
  windowStart: string; // datetime-local 原始值
  windowEnd: string;
  unloadAmount: number | string;
  currentStock: number | string;
}

export function createDraftRow(): BatchDraftRow {
  return {
    stationId: "",
    tankNo: "",
    windowStart: "",
    windowEnd: "",
    unloadAmount: "",
    currentStock: ""
  };
}
