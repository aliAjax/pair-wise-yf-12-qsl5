# 油站网点地图管理

- 行业：石油
- 技术栈：Vue3、Vite、TypeScript、Element Plus、Leaflet
- 启动：`npm install && npm run dev`
- 构建：`npm run build`

这是一个功能最小闭环前端项目，数据默认保存在浏览器localStorage中，方便后续扩展接口、权限、图表或地图能力。

## 油罐车到站排程

- 一次提交可排多站（整批），油罐编号、到站窗口、卸油量、当前库存必填。
- 同一罐车窗口重叠，或卸油后超过油罐容量时整批拒绝，原排程、库存、状态均不变。
- 确认到站后油站置为「卸油中」并锁定流转；完成卸油按实收量更新库存并恢复营业。
- 筛选、指标、图表与 localStorage 同步，刷新后保留。

代码分层：

- `src/domain/scheduling.ts`：排程规则（整批校验、窗口重叠、容量核算）
- `src/domain/stationFlow.ts`：油站状态流转（卸油中锁定、恢复营业）
- `src/storage/localStore.ts`：本地持久化读写
