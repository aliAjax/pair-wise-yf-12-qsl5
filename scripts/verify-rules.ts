import { validateBatch } from "../src/schedule/rules";
import { arrive, complete } from "../src/schedule/flow";
import type { Schedule, SchedulableStation, BatchDraftRow } from "../src/schedule/types";

const stations: SchedulableStation[] = [
  { id: "s1", station: "东区一站", area: "东区", stock: 36000, capacity: 50000, status: "营业中", notes: "", createdAt: "" },
  { id: "s2", station: "机场快线站", area: "机场线", stock: 9000, capacity: 40000, status: "库存紧张", notes: "", createdAt: "" }
];

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name} ${detail ?? ""}`); }
}

const snapshot = JSON.stringify(stations);

// 1. 必填校验
const r1 = validateBatch([{ stationId: "", tankNo: "", windowStart: "", windowEnd: "", unloadAmount: "", currentStock: "" }], stations, []);
check("必填缺失 -> 拒绝", !r1.ok && r1.errors.length >= 4, JSON.stringify(r1.errors));

// 2. 合法批量
const good: BatchDraftRow[] = [
  { stationId: "s1", tankNo: "T-01", windowStart: "2026-09-21T08:00", windowEnd: "2026-09-21T10:00", unloadAmount: 8000, currentStock: 36000 },
  { stationId: "s2", tankNo: "T-02", windowStart: "2026-09-21T08:00", windowEnd: "2026-09-21T10:00", unloadAmount: 5000, currentStock: 9000 }
];
const r2 = validateBatch(good, stations, []);
check("不同罐车同窗 -> 通过", r2.ok, JSON.stringify(r2.errors));

// 3. 批内同罐窗口重叠 -> 整批拒绝
const overlap: BatchDraftRow[] = [
  { stationId: "s1", tankNo: "T-03", windowStart: "2026-09-22T08:00", windowEnd: "2026-09-22T10:00", unloadAmount: 1000, currentStock: 36000 },
  { stationId: "s2", tankNo: "T-03", windowStart: "2026-09-22T09:30", windowEnd: "2026-09-22T11:00", unloadAmount: 1000, currentStock: 9000 }
];
const r3 = validateBatch(overlap, stations, []);
check("批内同罐窗口重叠 -> 整批拒绝", !r3.ok && r3.errors.some((e) => e.includes("重叠")));

// 窗口相接（10:00 = 10:00）不算重叠
const touch: BatchDraftRow[] = [
  { stationId: "s1", tankNo: "T-04", windowStart: "2026-09-22T08:00", windowEnd: "2026-09-22T10:00", unloadAmount: 1000, currentStock: 36000 },
  { stationId: "s2", tankNo: "T-04", windowStart: "2026-09-22T10:00", windowEnd: "2026-09-22T11:00", unloadAmount: 1000, currentStock: 9000 }
];
check("窗口端点相接 -> 通过", validateBatch(touch, stations, []).ok);

// 4. 超容量 -> 整批拒绝（36000 + 20000 > 50000）
const over: BatchDraftRow[] = [
  { stationId: "s1", tankNo: "T-05", windowStart: "2026-09-23T08:00", windowEnd: "2026-09-23T10:00", unloadAmount: 20000, currentStock: 36000 }
];
check("卸油后超容量 -> 拒绝", !validateBatch(over, stations, []).ok);
check("拒绝后库存不变", JSON.stringify(stations) === snapshot);

// 5. 与既有排程冲突
const existing: Schedule[] = [
  { id: "e1", batchId: "b1", stationId: "s1", stationName: "东区一站", tankNo: "T-09", windowStart: new Date("2026-09-24T08:00").toISOString(), windowEnd: new Date("2026-09-24T12:00").toISOString(), unloadAmount: 1000, currentStock: 36000, status: "待到站", createdAt: new Date().toISOString() }
];
const conflict: BatchDraftRow[] = [
  { stationId: "s2", tankNo: "T-09", windowStart: "2026-09-24T11:00", windowEnd: "2026-09-24T13:00", unloadAmount: 1000, currentStock: 9000 }
];
check("与既有未完成排程窗口重叠 -> 拒绝", !validateBatch(conflict, stations, existing).ok);

// 既有排程预占容量：s1 已有 14000 待卸（36000+14000=50000），再排 100 即超
const existingCap: Schedule[] = [
  { id: "e2", batchId: "b2", stationId: "s1", stationName: "东区一站", tankNo: "T-10", windowStart: new Date("2026-09-25T08:00").toISOString(), windowEnd: new Date("2026-09-25T10:00").toISOString(), unloadAmount: 14000, currentStock: 36000, status: "待到站", createdAt: new Date().toISOString() }
];
const capEdge: BatchDraftRow[] = [
  { stationId: "s1", tankNo: "T-11", windowStart: "2026-09-26T08:00", windowEnd: "2026-09-26T10:00", unloadAmount: 100, currentStock: 36000 }
];
check("既有排程预占容量后超容 -> 拒绝", !validateBatch(capEdge, stations, existingCap).ok);

// 6. 当前库存与系统不一致 -> 拒绝
const stale: BatchDraftRow[] = [
  { stationId: "s1", tankNo: "T-12", windowStart: "2026-09-27T08:00", windowEnd: "2026-09-27T10:00", unloadAmount: 100, currentStock: 30000 }
];
check("库存确认值过期 -> 拒绝", !validateBatch(stale, stations, []).ok);

// 7. 状态流转
const sched: Schedule[] = [
  { id: "x1", batchId: "b3", stationId: "s2", stationName: "机场快线站", tankNo: "T-20", windowStart: new Date().toISOString(), windowEnd: new Date(Date.now() + 3600000).toISOString(), unloadAmount: 5000, currentStock: 9000, status: "待到站", createdAt: new Date().toISOString() }
];
const st2 = JSON.parse(JSON.stringify(stations)) as SchedulableStation[];
const schedBefore = JSON.stringify(sched);
const stBefore = JSON.stringify(st2);
const a = arrive(sched, st2, "x1");
check("到站成功", a.ok && a.schedules[0].status === "卸油中" && a.stations.find((s) => s.id === "s2")!.status === "卸油中");
check("到站不修改入参（原排程/状态不变）", JSON.stringify(sched) === schedBefore && JSON.stringify(st2) === stBefore);

// 不能对卸油中重复到站（用 a 的结果再次到站应失败，且返回的是同一引用）
const a2 = arrive(a.schedules, a.stations, "x1");
check("重复到站拒绝", !a2.ok && a2.schedules === a.schedules);

const cBad = complete(a.schedules, a.stations, "x1", 40000); // 9000+40000 > 40000
check("实收超容量 -> 完成拒绝", !cBad.ok);
const cBadZero = complete(a.schedules, a.stations, "x1", 0);
check("实收为 0 -> 拒绝", !cBadZero.ok);

const c = complete(a.schedules, a.stations, "x1", 5000);
const doneStation = c.stations.find((s) => s.id === "s2")!;
check("完成卸油恢复营业并按实收更新库存", c.ok && c.schedules[0].status === "已完成" && c.schedules[0].actualAmount === 5000 && doneStation.status === "营业中" && doneStation.stock === 14000);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
