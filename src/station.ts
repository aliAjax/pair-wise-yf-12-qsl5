// 油站网点记录类型
export interface RecordItem {
  id: string;
  status: string;
  notes: string;
  createdAt: string;
  [key: string]: string | number;
}
