<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import {
  ALL_STATUSES,
  BUSINESS_STATUSES,
  UNLOADING_STATUS,
  canFlow,
  nextStatus,
  statusOnArrival,
  statusOnUnloadDone,
  type Station
} from "./domain/stationFlow";
import {
  buildSchedules,
  validateBatch,
  type Schedule,
  type ScheduleRowInput
} from "./domain/scheduling";
import { load, save } from "./storage/localStore";

type Field = {
  key: string;
  label: string;
  type?: "number" | "date" | "select";
  options?: readonly string[];
};

const project = {
  "number": 21,
  "folder": "hxwl/frontend/hxwlfront-21",
  "framework": "vue",
  "title": "油站网点地图管理",
  "subtitle": "维护油站位置、营业状态和库存摘要，并编排油罐车到站卸油。",
  "industry": "石油",
  "stack": [
    "Vue3",
    "Vite",
    "TypeScript",
    "Element Plus",
    "Leaflet"
  ],
  "storageKey": "hxwlfront-21-station-map",
  "scheduleStorageKey": "hxwlfront-21-station-schedules",
  "formTitle": "新增油站",
  "primaryAction": "保存油站",
  "scheduleFormTitle": "油罐车到站排程",
  "scheduleAction": "提交整批排程",
  "entityLabel": "油站",
  "filters": [
    "全部区域",
    "东区",
    "西区",
    "机场线"
  ],
  "fields": [
    {
      "key": "station",
      "label": "油站名称"
    },
    {
      "key": "area",
      "label": "区域",
      "type": "select",
      "options": [
        "东区",
        "西区",
        "机场线"
      ]
    },
    {
      "key": "stock",
      "label": "库存摘要L",
      "type": "number"
    },
    {
      "key": "capacity",
      "label": "油罐容量L",
      "type": "number"
    },
    {
      "key": "manager",
      "label": "负责人"
    }
  ],
  "records": [
    {
      "station": "东区一站",
      "area": "东区",
      "stock": 36000,
      "capacity": 50000,
      "manager": "刘站长",
      "status": "营业中",
      "notes": "库存正常"
    },
    {
      "station": "机场快线站",
      "area": "机场线",
      "stock": 9000,
      "capacity": 30000,
      "manager": "王站长",
      "status": "库存紧张",
      "notes": "柴油待补"
    }
  ],
  "metricLabels": [
    "油站数",
    "营业中",
    "库存紧张",
    "卸油中"
  ]
} as const;

const fields = project.fields as readonly Field[];

function createBlank() {
  return Object.fromEntries(fields.map((field) => [field.key, field.type === "number" ? 0 : ""]));
}

function seedStations(): Station[] {
  return project.records.map((record, index) => ({
    ...record,
    id: `seed-${index + 1}`,
    createdAt: new Date(Date.now() - index * 86400000).toISOString()
  })) as Station[];
}

/** 兼容旧缓存：补齐后加的字段 */
function withDefaults(raw: Partial<Station> & { id: string }): Station {
  return {
    station: "",
    area: "",
    stock: 0,
    capacity: 50000,
    manager: "",
    status: BUSINESS_STATUSES[0],
    notes: "",
    createdAt: new Date().toISOString(),
    ...raw
  };
}

const stations = ref<Station[]>(load(project.storageKey, seedStations).map(withDefaults));
const schedules = ref<Schedule[]>(load(project.scheduleStorageKey, () => []));
const form = reactive<Record<string, string | number>>(createBlank());
const note = ref("");
const filter = ref(project.filters[0]);

function blankRow(): ScheduleRowInput {
  return { stationId: "", tankerId: "", windowStart: "", windowEnd: "", plannedVolume: 0, currentStock: 0 };
}

const scheduleRows = ref<ScheduleRowInput[]>([blankRow()]);
const scheduleErrors = ref<string[]>([]);
const scheduleNotice = ref("");
const actionError = ref("");
const actualInputs = reactive<Record<string, number>>({});

const filteredStations = computed(() => {
  if (filter.value.startsWith("全部")) return stations.value;
  return stations.value.filter((station) => station.area === filter.value);
});

const filteredSchedules = computed(() => {
  const visible = new Set(filteredStations.value.map((station) => station.id));
  return schedules.value.filter((schedule) => visible.has(schedule.stationId));
});

const metrics = computed(() => [
  stations.value.length,
  stations.value.filter((station) => station.status === BUSINESS_STATUSES[0]).length,
  stations.value.filter((station) => station.status === BUSINESS_STATUSES[2]).length,
  stations.value.filter((station) => station.status === UNLOADING_STATUS).length
]);

const chartRows = computed(() => ALL_STATUSES.map((status) => ({
  status,
  value: stations.value.filter((station) => station.status === status).length
})));

const maxChart = computed(() => Math.max(1, ...chartRows.value.map((row) => row.value)));

function persist() {
  save(project.storageKey, stations.value);
  save(project.scheduleStorageKey, schedules.value);
}

function primaryText(station: Station) {
  const first = fields[0];
  const second = fields[1];
  return [station[first.key as keyof Station], station[second.key as keyof Station]]
    .filter(Boolean)
    .join(" / ") || project.entityLabel;
}

function stationName(id: string) {
  return stations.value.find((station) => station.id === id)?.station ?? "（油站已删除）";
}

function formatWindow(value: string) {
  return value ? value.replace("T", " ") : "-";
}

function submit() {
  stations.value = [
    {
      ...form,
      id: crypto.randomUUID(),
      status: BUSINESS_STATUSES[0],
      notes: note.value || "暂无备注",
      createdAt: new Date().toISOString()
    } as unknown as Station,
    ...stations.value
  ];
  Object.assign(form, createBlank());
  note.value = "";
  persist();
}

function flow(station: Station) {
  if (!canFlow(station.status)) return;
  station.status = nextStatus(station.status);
  persist();
}

function remove(id: string) {
  stations.value = stations.value.filter((station) => station.id !== id);
  persist();
}

function syncRowStock(row: ScheduleRowInput) {
  const station = stations.value.find((item) => item.id === row.stationId);
  if (station) row.currentStock = station.stock;
}

function addRow() {
  scheduleRows.value = [...scheduleRows.value, blankRow()];
}

function removeRow(index: number) {
  scheduleRows.value = scheduleRows.value.filter((_, i) => i !== index);
}

function submitSchedules() {
  // 整批校验：任一规则不满足即整批拒绝，排程、库存、状态全部保持原样
  const result = validateBatch(scheduleRows.value, stations.value, schedules.value);
  if (!result.ok) {
    scheduleErrors.value = result.errors;
    scheduleNotice.value = "";
    return;
  }
  const batch = buildSchedules(scheduleRows.value, crypto.randomUUID());
  schedules.value = [...batch, ...schedules.value];
  scheduleRows.value = [blankRow()];
  scheduleErrors.value = [];
  scheduleNotice.value = `已受理 ${batch.length} 条排程（同一批次 ${batch[0].batchId.slice(0, 8)}）`;
  persist();
}

function arrive(schedule: Schedule) {
  if (schedule.status !== "待到站") return;
  schedule.status = "卸油中";
  actualInputs[schedule.id] = schedule.plannedVolume;
  const station = stations.value.find((item) => item.id === schedule.stationId);
  if (station) station.status = statusOnArrival();
  persist();
}

function complete(schedule: Schedule) {
  if (schedule.status !== "卸油中") return;
  const actual = Number(actualInputs[schedule.id] ?? schedule.plannedVolume);
  if (!Number.isFinite(actual) || actual < 0) {
    actionError.value = `排程 ${schedule.tankerId} 的实收量必须是不小于 0 的数字`;
    return;
  }
  actionError.value = "";
  schedule.actualVolume = actual;
  schedule.status = "已完成";
  const station = stations.value.find((item) => item.id === schedule.stationId);
  if (station) {
    station.stock += actual;
    const hasOtherUnloading = schedules.value.some(
      (item) => item.stationId === station.id && item.status === "卸油中"
    );
    station.status = statusOnUnloadDone(hasOtherUnloading);
  }
  persist();
}
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
        <div class="side">
          <form class="panel" @submit.prevent="submit">
            <h2>{{ project.formTitle }}</h2>
            <div class="form-grid">
              <label v-for="field in fields" :key="field.key">
                {{ field.label }}
                <select v-if="field.type === 'select'" v-model="form[field.key]" required>
                  <option value="">请选择</option>
                  <option v-for="option in field.options" :key="option">{{ option }}</option>
                </select>
                <input v-else v-model="form[field.key]" :type="field.type || 'text'" required />
              </label>
              <label>
                备注
                <textarea v-model="note" placeholder="填写处理说明或现场备注" />
              </label>
              <button type="submit">{{ project.primaryAction }}</button>
            </div>
          </form>

          <form class="panel" @submit.prevent="submitSchedules">
            <h2>{{ project.scheduleFormTitle }}</h2>
            <p class="hint">一次可排多站；同一罐车窗口重叠或卸油后超过油罐容量，整批拒绝且不影响现有排程与库存。</p>
            <div class="schedule-rows">
              <div v-for="(row, index) in scheduleRows" :key="index" class="schedule-row">
                <div class="row-head">
                  <strong>排程 {{ index + 1 }}</strong>
                  <button
                    v-if="scheduleRows.length > 1"
                    class="danger"
                    type="button"
                    @click="removeRow(index)"
                  >移除</button>
                </div>
                <label>
                  油站
                  <select v-model="row.stationId" required @change="syncRowStock(row)">
                    <option value="">请选择</option>
                    <option v-for="station in stations" :key="station.id" :value="station.id">
                      {{ station.station }}
                    </option>
                  </select>
                </label>
                <label>
                  油罐编号
                  <input v-model="row.tankerId" placeholder="如 TK-1024" required />
                </label>
                <label>
                  到站窗口起
                  <input v-model="row.windowStart" type="datetime-local" required />
                </label>
                <label>
                  到站窗口止
                  <input v-model="row.windowEnd" type="datetime-local" required />
                </label>
                <label>
                  卸油量L
                  <input v-model.number="row.plannedVolume" type="number" min="1" required />
                </label>
                <label>
                  当前库存L
                  <input v-model.number="row.currentStock" type="number" min="0" required />
                </label>
              </div>
            </div>
            <div class="actions">
              <button class="secondary" type="button" @click="addRow">添加一站</button>
              <button type="submit">{{ project.scheduleAction }}</button>
            </div>
            <ul v-if="scheduleErrors.length" class="error-list">
              <li v-for="error in scheduleErrors" :key="error">{{ error }}</li>
            </ul>
            <p v-if="scheduleNotice" class="notice">{{ scheduleNotice }}</p>
          </form>
        </div>

        <section class="list-panel">
          <div class="toolbar">
            <h2>{{ project.entityLabel }}列表</h2>
            <select v-model="filter">
              <option v-for="item in project.filters" :key="item">{{ item }}</option>
            </select>
          </div>

          <div class="record-grid">
            <div v-if="filteredStations.length === 0" class="empty">暂无匹配数据</div>
            <article v-for="station in filteredStations" :key="station.id" class="record">
              <div class="record-head">
                <p class="record-title">{{ primaryText(station) }}</p>
                <span class="status" :class="{ unloading: station.status === UNLOADING_STATUS }">
                  {{ station.status }}
                </span>
              </div>
              <div class="details">
                <span v-for="field in fields" :key="field.key">{{ field.label }}: {{ station[field.key as keyof Station] }}</span>
              </div>
              <p class="note">{{ station.notes }}</p>
              <div class="actions">
                <button
                  type="button"
                  :disabled="!canFlow(station.status)"
                  :title="canFlow(station.status) ? '' : '卸油中，完成卸油后恢复流转'"
                  @click="flow(station)"
                >{{ canFlow(station.status) ? "流转状态" : "卸油中·锁定" }}</button>
                <button class="secondary" type="button" @click="navigator.clipboard?.writeText(primaryText(station))">复制摘要</button>
                <button class="danger" type="button" @click="remove(station.id)">删除</button>
              </div>
            </article>
          </div>

          <div class="schedule-list">
            <h3>到站排程</h3>
            <div v-if="filteredSchedules.length === 0" class="empty">暂无排程</div>
            <article v-for="schedule in filteredSchedules" :key="schedule.id" class="record">
              <div class="record-head">
                <p class="record-title">{{ stationName(schedule.stationId) }} / {{ schedule.tankerId }}</p>
                <span class="status" :class="`schedule-${schedule.status}`">{{ schedule.status }}</span>
              </div>
              <div class="details">
                <span>窗口: {{ formatWindow(schedule.windowStart) }} ~ {{ formatWindow(schedule.windowEnd) }}</span>
                <span>计划卸油: {{ schedule.plannedVolume }}L</span>
                <span>登记库存: {{ schedule.currentStock }}L</span>
                <span v-if="schedule.actualVolume !== null">实收: {{ schedule.actualVolume }}L</span>
                <span>批次: {{ schedule.batchId.slice(0, 8) }}</span>
              </div>
              <div class="actions">
                <button v-if="schedule.status === '待到站'" type="button" @click="arrive(schedule)">确认到站</button>
                <template v-if="schedule.status === '卸油中'">
                  <input
                    v-model.number="actualInputs[schedule.id]"
                    class="actual-input"
                    type="number"
                    min="0"
                    placeholder="实收量L"
                  />
                  <button type="button" @click="complete(schedule)">完成卸油</button>
                </template>
              </div>
            </article>
            <p v-if="actionError" class="error-text">{{ actionError }}</p>
          </div>

          <div class="mini-chart">
            <div v-for="row in chartRows" :key="row.status" class="bar">
              <span>{{ row.status }}</span>
              <div class="bar-track"><div class="bar-fill" :style="{ width: `${(row.value / maxChart) * 100}%` }" /></div>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
        </section>
      </section>
    </div>
  </main>
</template>
