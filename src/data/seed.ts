import type { StoreData } from "../models";
export function seedData(): StoreData {
  return {
    version: 1,
    items: [
      {
        id: "water-heater",
        name: "電熱水器",
        date: "2025-10-01",
        category: "家電設備",
        brand: "櫻花 · 儲熱式電熱水器",
        location: "家裡 / 主浴室",
        amount: 18500,
        description:
          "40 公升儲熱式電熱水器，含到府安裝、舊機回收與管線檢查。保固兩年，購買憑證收在家用文件夾。",
        notes: [
          {
            id: "note-1",
            date: "2025-10-01",
            text: "安裝完成，師傅提醒每半年清理水垢，並定期測試漏電斷路器。",
          },
          {
            id: "note-2",
            date: "2026-04-01",
            text: "保養時檢查進出水管接頭，沒有漏水；水溫設定 60°C。",
          },
        ],
        photos: [
          {
            id: "demo-photo",
            name: "電熱水器示意圖",
            url: `${import.meta.env.BASE_URL}heater.svg`,
          },
        ],
        tasks: [
          {
            id: "rod",
            name: "更換加熱棒",
            intervalDays: 365,
            anchorDate: "2025-10-01",
          },
          {
            id: "scale",
            name: "清理水垢",
            intervalDays: 180,
            anchorDate: "2025-10-01",
          },
          {
            id: "safety",
            name: "安全檢查",
            intervalDays: 60,
            anchorDate: "2025-10-01",
          },
        ],
        history: [
          {
            id: "history-1",
            taskId: "scale",
            taskName: "清理水垢",
            date: "2026-04-01",
            amount: 1200,
            note: "拆洗內膽、清除水垢，更換密封墊圈，試機正常。",
            photos: [],
          },
          {
            id: "history-2",
            taskId: "safety",
            taskName: "安全檢查",
            date: "2026-09-20",
            amount: 0,
            note: "漏電斷路器測試正常，管線無滲漏。",
            photos: [],
          },
          {
            id: "history-3",
            taskId: "rod",
            taskName: "更換加熱棒",
            date: "2026-10-01",
            amount: 2400,
            note: "更換加熱棒及檢查溫控器，加熱功能正常。",
            photos: [],
          },
        ],
      },
    ],
  };
}
