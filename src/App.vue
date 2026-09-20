<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import type { RecordItem } from "./station";
import {
  createDraftRow,
  type BatchDraftRow,
  type Schedule,
  type SchedulableStation,
  SCHEDULE_STATUSES
} from "./schedule/types";
import { validateBatch } from "./schedule/rules";
import { arrive, complete, isStationLocked } from "./schedule/flow";
import {
  loadStations,
  saveStations,
  loadSchedules,
  saveSchedules,
  STATION_CAPACITY_DEFAULT
} from "./schedule/storage";

type Field = {
  key: string;
  label: string;
  type?: "number" | "date" | "select";
  options?: readonly string[];
};

const project = {
  number: 21,
  framework: "vue",
  title: "油站网点地图管理",
  subtitle: "维护油站位置、营业状态、库存摘要与油罐车到站排程。",
  industry: "石油",
  stack: ["Vue3", "Vite", "TypeScript", "Element Plus", "Leaflet"],
  formTitle: "新增油站",
  primaryAction: "保存油站",
  entityLabel: "油站",
  statuses: ["营业中", "暂停营业", "库存紧张"] as const,
  // 卸油中为系统驱动状态，不参与人工流转
  chartStatuses: ["营业中", "暂停营业", "库存紧张", "卸油中"] as const,
  filters: ["全部区域", "东区", "西区", "机场线"],
  fields: [
    { key: "station", label: "油站名称" },
    { key: "area", label: "区域", type: "select", options: ["东区", "西区", "机场线"] },
    { key: "stock", label: "当前库存L", type: "number" },
    { key: "capacity", label: "油罐容量L", type: "number" },
    { key: "manager", label: "负责人" }
  ] as readonly Field[],
  records: [
    { station: "东区一站", area: "东区", stock: 36000, capacity: 50000, manager: "刘站长", status: "营业中", notes: "库存正常" },
    { station: "机场快线站", area: "机场线", stock: 9000, capacity: 40000, manager: "王站长", status: "库存紧张", notes: "柴油待补" }
  ],
  metricLabels: ["油站数", "营业中", "库存紧张", "待到站", "卸油中", "待卸油量L"]
} as const;

const fields = project.fields;
const statuses: string[] = [...project.statuses];

function createBlank() {
  const blank: Record<string, string | number> = Object.fromEntries(
    fields.map((field) => [field.key, field.type === "number" ? 0 : ""])
  );
  blank.capacity = STATION_CAPACITY_DEFAULT;
  return blank;
}

function seedRecords(): RecordItem[] {
  return project.records.map((record, index) => ({
    ...record,
    id: `seed-${index + 1}`,
    createdAt: new Date(Date.now() - index * 86400000).toISOString()
  }));
}

// ---------------- 状态与本地持久化（刷新后保留） ----------------
const records = ref<RecordItem[]>(loadStations(seedRecords));
const schedules = ref<Schedule[]>(loadSchedules());

const form = reactive<Record<string, string | number>>(createBlank());
const note = ref("");
const filter = ref<string>(project.filters[0]);

function persistStations() {
  saveStations(records.value);
}
function persistSchedules() {
  saveSchedules(schedules.value);
}

// ---------------- 网点筛选 / 指标 / 图表 ----------------
const stationMap = computed(() => new Map(records.value.map((record) => [record.id, record])));

const filteredRecords = computed(() => {
  if (filter.value.startsWith("全部")) return records.value;
  return records.value.filter((record) => Object.values(record).includes(filter.value));
});

const metrics = computed(() => {
  const list = records.value;
  const total = list.length;
  const openCount = list.filter((r) => r.status === "营业中").length;
  const tightCount = list.filter((r) => r.status === "库存紧张").length;
  const waiting = schedules.value.filter((s) => s.status === "待到站").length;
  const unloading = schedules.value.filter((s) => s.status === "卸油中").length;
  const pendingLiters = schedules.value
    .filter((s) => s.status !== "已完成")
    .reduce((sum, s) => sum + s.unloadAmount, 0);
  return [total, openCount, tightCount, waiting, unloading, pendingLiters];
});

const stationChartRows = computed(() =>
  project.chartStatuses.map((status) => ({
    status,
    value: records.value.filter((record) => record.status === status).length
  }))
);

const scheduleChartRows = computed(() =>
  SCHEDULE_STATUSES.map((status) => ({
    status,
    value: schedules.value.filter((item) => item.status === status).length
  }))
);

const maxChart = computed(() =>
  Math.max(1, ...stationChartRows.value.map((row) => row.value), ...scheduleChartRows.value.map((row) => row.value))
);

// ---------------- 油站新增 / 流转 / 删除 ----------------
function nextStatus(status: string) {
  const index = statuses.indexOf(status);
  return statuses[(index + 1) % statuses.length];
}

function primaryText(record: RecordItem) {
  const first = fields[0];
  const second = fields[1];
  return [record[first.key], record[second.key]].filter(Boolean).join(" / ") || project.entityLabel;
}

function submitStation() {
  records.value = [
    { ...form, id: crypto.randomUUID(), status: statuses[0], notes: note.value || "暂无备注", createdAt: new Date().toISOString() } as RecordItem,
    ...records.value
  ];
  Object.assign(form, createBlank());
  note.value = "";
  persistStations();
}

function flowStation(record: RecordItem) {
  // 卸油中由排程驱动，锁定不能流转
  if (isStationLocked(record.id, schedules.value)) {
    flash(`「${record.station}」正在卸油，完成卸油后才能恢复营业流转`);
    return;
  }
  record.status = nextStatus(record.status);
  persistStations();
}

function removeStation(record: RecordItem) {
  if (isStationLocked(record.id, schedules.value)) {
    flash(`「${record.station}」正在卸油，不能删除`);
    return;
  }
  if (schedules.value.some((s) => s.stationId === record.id && s.status !== "已完成")) {
    flash(`「${record.station}」存在未完成排程，不能删除`);
    return;
  }
  records.value = records.value.filter((item) => item.id !== record.id);
  persistStations();
}

// ---------------- 批量排程 ----------------
const drafts = ref<BatchDraftRow[]>([createDraftRow()]);
const batchMessage = ref<{ type: "error" | "success"; text: string } | null>(null);

const schedulableStations = computed<SchedulableStation[]>(() =>
  records.value.map((record) => ({
    ...record,
    stock: Number(record.stock) || 0,
    capacity: Number(record.capacity) || 0
  }))
);

function addDraftRow() {
  drafts.value.push(createDraftRow());
}

function removeDraftRow(index: number) {
  if (drafts.value.length === 1) {
    drafts.value = [createDraftRow()];
    return;
  }
  drafts.value.splice(index, 1);
}

function syncStock(row: BatchDraftRow) {
  const station = stationMap.value.get(row.stationId);
  if (station) row.currentStock = Number(station.stock) || 0;
}

function submitBatch() {
  // 规则全部在 rules 模块校验：任何一行不通过则整批拒绝，原数据不变
  const result = validateBatch(drafts.value, schedulableStations.value, schedules.value);
  if (!result.ok || !result.rows) {
    batchMessage.value = { type: "error", text: `整批拒绝：${result.errors.join("；")}` };
    return;
  }

  const now = new Date().toISOString();
  const batchId = crypto.randomUUID();
  const created: Schedule[] = result.rows.map((row) => {
    const station = stationMap.value.get(row.stationId)!;
    return {
      id: crypto.randomUUID(),
      batchId,
      stationId: row.stationId,
      stationName: String(station.station),
      tankNo: row.tankNo,
      windowStart: row.windowStart,
      windowEnd: row.windowEnd,
      unloadAmount: row.unloadAmount,
      currentStock: row.currentStock,
      status: "待到站",
      createdAt: now
    };
  });

  schedules.value = [...created, ...schedules.value];
  persistSchedules();
  drafts.value = [createDraftRow()];
  batchMessage.value = { type: "success", text: `排程成功：本批 ${created.length} 站已提交` };
}

// ---------------- 排程筛选（与网点区域筛选联动） ----------------
const scheduleStatusFilter = ref<string>("全部状态");
const scheduleKeyword = ref("");

const scheduleFilterStatuses = ["全部状态", ...SCHEDULE_STATUSES];

const filteredSchedules = computed(() => {
  const keyword = scheduleKeyword.value.trim();
  return schedules.value.filter((item) => {
    if (filter.value.startsWith("全部") === false) {
      const station = stationMap.value.get(item.stationId);
      if (!station || station.area !== filter.value) return false;
    }
    if (scheduleStatusFilter.value !== "全部状态" && item.status !== scheduleStatusFilter.value) return false;
    if (keyword && !`${item.tankNo}${item.stationName}`.includes(keyword)) return false;
    return true;
  });
});

// ---------------- 到站 / 完成卸油 ----------------
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function flash(text: string) {
  toast.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ""), 3000);
}

function formatWindow(item: Schedule) {
  const fmt = (iso: string) => new Date(iso).toLocaleString("zh-CN", { hour12: false });
  return `${fmt(item.windowStart)} ~ ${fmt(item.windowEnd)}`;
}

function doArrive(item: Schedule) {
  const result = arrive(schedules.value, schedulableStations.value, item.id);
  if (!result.ok) {
    flash(result.message);
    return;
  }
  schedules.value = result.schedules;
  records.value = result.stations as RecordItem[];
  persistSchedules();
  persistStations();
  flash(result.message);
}

const completingId = ref<string | null>(null);
const actualInput = ref<number | string>("");

function startComplete(item: Schedule) {
  completingId.value = item.id;
  actualInput.value = item.unloadAmount;
}

function cancelComplete() {
  completingId.value = null;
  actualInput.value = "";
}

function confirmComplete(item: Schedule) {
  const actual = Number(actualInput.value);
  const result = complete(schedules.value, schedulableStations.value, item.id, actual);
  if (!result.ok) {
    flash(result.message);
    return;
  }
  schedules.value = result.schedules;
  records.value = result.stations as RecordItem[];
  persistSchedules();
  persistStations();
  completingId.value = null;
  actualInput.value = "";
  flash(result.message);
}

// 页面打开时若已到窗口开始时间，给出提示（不自动改状态，到站以确认为准）
const nowHint = computed(() => {
  const count = schedules.value.filter(
    (s) => s.status === "待到站" && new Date(s.windowStart).getTime() <= Date.now()
  ).length;
  return count > 0 ? `有 ${count} 个排程已到到站窗口，请确认到站` : "";
});
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">{{ project.industry }}行业前端最小闭环</p>
          <h1>{{ project.title }}</h1>
          <p class="subtitle">{{ project.subtitle }}</p>
        </div>
        <div class="stack">
          <span v-for="item in project.stack" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="(label, index) in project.metricLabels" :key="label" class="metric">
          <span>{{ label }}</span>
          <strong>{{ metrics[index] }}</strong>
        </article>
      </section>

      <section class="workspace">
        <form class="panel" @submit.prevent="submitStation">
          <h2>{{ project.formTitle }}</h2>
          <div class="form-grid">
            <label v-for="field in fields" :key="field.key">
              {{ field.label }}
              <select v-if="field.type === 'select'" v-model="form[field.key]" required>
                <option value="">请选择</option>
                <option v-for="option in field.options" :key="option">{{ option }}</option>
              </select>
              <input v-else v-model="form[field.key]" :type="field.type || 'text'" :min="field.type === 'number' ? 0 : undefined" required />
            </label>
            <label>
              备注
              <textarea v-model="note" placeholder="填写处理说明或现场备注" />
            </label>
            <button type="submit">{{ project.primaryAction }}</button>
          </div>
        </form>

        <section class="list-panel">
          <div class="toolbar">
            <h2>{{ project.entityLabel }}列表</h2>
            <select v-model="filter">
              <option v-for="item in project.filters" :key="item">{{ item }}</option>
            </select>
          </div>

          <div class="record-grid">
            <div v-if="filteredRecords.length === 0" class="empty">暂无匹配数据</div>
            <article v-for="record in filteredRecords" :key="record.id" class="record">
              <div class="record-head">
                <p class="record-title">{{ primaryText(record) }}</p>
                <span class="status" :class="{ 'status-unloading': record.status === '卸油中' }">{{ record.status }}</span>
              </div>
              <div class="details">
                <span v-for="field in fields" :key="field.key">{{ field.label }}: {{ record[field.key] }}</span>
              </div>
              <p class="note">{{ record.notes }}</p>
              <div class="actions">
                <button type="button" :disabled="record.status === '卸油中'" @click="flowStation(record)">流转状态</button>
                <button class="secondary" type="button" @click="navigator.clipboard?.writeText(primaryText(record))">复制摘要</button>
                <button class="danger" type="button" @click="removeStation(record)">删除</button>
              </div>
            </article>
          </div>

          <div class="mini-chart">
            <p class="chart-title">油站状态分布</p>
            <div v-for="row in stationChartRows" :key="row.status" class="bar">
              <span>{{ row.status }}</span>
              <div class="bar-track"><div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" /></div>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </section>
      </section>

      <section class="schedule-panel">
        <div class="schedule-head">
          <h2>油罐车到站排程</h2>
          <p class="schedule-tip">
            一次可提交多站；油罐编号、到站窗口、卸油量、当前库存必填。同罐车窗口重叠或卸油后超过油罐容量，整批拒绝。
          </p>
        </div>

        <div class="batch-table-wrap">
          <table class="batch-table">
            <thead>
              <tr>
                <th style="width: 180px">油站</th>
                <th style="width: 130px">油罐编号</th>
                <th style="width: 200px">到站开始</th>
                <th style="width: 200px">到站结束</th>
                <th style="width: 130px">卸油量L</th>
                <th style="width: 140px">当前库存L</th>
                <th style="width: 70px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in drafts" :key="index">
                <td>
                  <select v-model="row.stationId" @change="syncStock(row)">
                    <option value="">请选择油站</option>
                    <option v-for="station in records" :key="station.id" :value="station.id">
                      {{ station.station }}（容{{ station.capacity }}L）
                    </option>
                  </select>
                </td>
                <td><input v-model="row.tankNo" placeholder="如 T-07" /></td>
                <td><input v-model="row.windowStart" type="datetime-local" /></td>
                <td><input v-model="row.windowEnd" type="datetime-local" /></td>
                <td><input v-model="row.unloadAmount" type="number" min="0" placeholder="计划卸油量" /></td>
                <td><input v-model="row.currentStock" type="number" min="0" placeholder="到站前库存" /></td>
                <td><button class="danger" type="button" @click="removeDraftRow(index)">移除</button></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="batch-actions">
          <button class="secondary" type="button" @click="addDraftRow">+ 添加一站</button>
          <button type="button" @click="submitBatch">整批提交排程</button>
        </div>
        <p v-if="batchMessage" class="batch-msg" :class="batchMessage.type">{{ batchMessage.text }}</p>

        <div class="toolbar schedule-toolbar">
          <h2>排程列表</h2>
          <div class="schedule-filters">
            <select v-model="scheduleStatusFilter">
              <option v-for="item in scheduleFilterStatuses" :key="item">{{ item }}</option>
            </select>
            <input v-model="scheduleKeyword" class="schedule-search" placeholder="搜索罐号 / 油站" />
          </div>
        </div>
        <p v-if="nowHint" class="batch-msg success">{{ nowHint }}</p>

        <div class="schedule-grid">
          <div v-if="filteredSchedules.length === 0" class="empty">暂无匹配排程</div>
          <article v-for="item in filteredSchedules" :key="item.id" class="schedule-card" :class="`sch-${item.status}`">
            <div class="record-head">
              <p class="record-title">{{ item.stationName }} · {{ item.tankNo }}</p>
              <span class="status" :class="{ 'status-unloading': item.status === '卸油中', 'status-done': item.status === '已完成' }">
                {{ item.status }}
              </span>
            </div>
            <div class="details">
              <span>到站窗口: {{ formatWindow(item) }}</span>
              <span>计划卸油: {{ item.unloadAmount }}L</span>
              <span>排程时库存: {{ item.currentStock }}L</span>
              <span v-if="item.status === '已完成'">实收: {{ item.actualAmount }}L</span>
            </div>
            <div class="actions">
              <template v-if="item.status === '待到站'">
                <button type="button" @click="doArrive(item)">确认到站</button>
              </template>
              <template v-else-if="item.status === '卸油中'">
                <template v-if="completingId === item.id">
                  <input v-model="actualInput" class="actual-input" type="number" min="0" placeholder="实收卸油量L" />
                  <button type="button" @click="confirmComplete(item)">按实收完成</button>
                  <button class="secondary" type="button" @click="cancelComplete">取消</button>
                </template>
                <button v-else type="button" @click="startComplete(item)">完成卸油</button>
              </template>
              <span v-else class="done-text">已于 {{ new Date(item.completedAt as string).toLocaleString('zh-CN', { hour12: false }) }} 完成</span>
            </div>
          </article>
        </div>

        <div class="mini-chart">
          <p class="chart-title">排程状态分布</p>
          <div v-for="row in scheduleChartRows" :key="row.status" class="bar">
            <span>{{ row.status }}</span>
            <div class="bar-track"><div class="bar-fill bar-fill-schedule" :style="{ width: `${(row.value / maxChart) * 100}%` }" /></div>
            <strong>{{ row.value }}</strong>
          </div>
        </div>
      </section>
    </div>

    <transition name="fade">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </transition>
  </main>
</template>
