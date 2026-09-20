/**
 * 油站状态流转规则。
 * 只承载“状态机能怎么转”的判断，不关心 UI 与持久化。
 */

export type Station = {
  id: string;
  station: string;
  area: string;
  stock: number;
  capacity: number;
  manager: string;
  status: string;
  notes: string;
  createdAt: string;
};

/** 可手工流转的经营状态（循环顺序） */
export const BUSINESS_STATUSES = ["营业中", "暂停营业", "库存紧张"] as const;

/** 卸油中：由排程事件进入/退出，不参与手工流转 */
export const UNLOADING_STATUS = "卸油中";

/** 全部状态（用于指标与图表） */
export const ALL_STATUSES: string[] = [...BUSINESS_STATUSES, UNLOADING_STATUS];

/** 手工流转的下一个状态，仅在经营状态间循环 */
export function nextStatus(current: string): string {
  const index = BUSINESS_STATUSES.indexOf(current as (typeof BUSINESS_STATUSES)[number]);
  const safeIndex = index < 0 ? 0 : index;
  return BUSINESS_STATUSES[(safeIndex + 1) % BUSINESS_STATUSES.length];
}

/** 卸油中的油站锁定，不允许流转 */
export function canFlow(status: string): boolean {
  return status !== UNLOADING_STATUS;
}

/** 罐车确认到站后油站进入的状态 */
export function statusOnArrival(): string {
  return UNLOADING_STATUS;
}

/** 卸油完成后油站恢复的状态；若同站还有其他罐车在卸油则保持卸油中 */
export function statusOnUnloadDone(hasOtherUnloading: boolean): string {
  return hasOtherUnloading ? UNLOADING_STATUS : BUSINESS_STATUSES[0];
}
