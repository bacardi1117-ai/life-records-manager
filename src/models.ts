export interface Photo {
  id: string;
  name: string;
  url: string;
}
export interface Note {
  id: string;
  date: string;
  text: string;
}
export interface MaintenanceRecord {
  id: string;
  taskId: string;
  taskName: string;
  date: string;
  amount: number;
  note: string;
  photos: Photo[];
}
export interface RecurringTask {
  id: string;
  name: string;
  intervalDays: number;
  anchorDate: string;
}
export interface LifeItem {
  id: string;
  name: string;
  date: string;
  category: string;
  brand: string;
  location: string;
  amount: number;
  description: string;
  notes: Note[];
  photos: Photo[];
  tasks: RecurringTask[];
  history: MaintenanceRecord[];
}
export interface StoreData {
  version: 1;
  items: LifeItem[];
}
