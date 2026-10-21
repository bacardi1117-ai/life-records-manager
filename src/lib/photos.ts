import type { Photo } from "../models";
export async function readPhotos(files: FileList | null): Promise<Photo[]> {
  if (!files) return [];
  if (files.length > 4) throw new Error("每次最多選擇 4 張照片");
  return Promise.all(
    Array.from(files).map((file) => {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
        throw new Error("請選擇 JPG、PNG 或 WebP 圖片");
      if (file.size > 800 * 1024)
        throw new Error("每張照片請小於 800 KB，以節省本機儲存空間");
      return new Promise<Photo>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          resolve({
            id: crypto.randomUUID(),
            name: file.name,
            url: String(reader.result),
          });
        reader.onerror = () => reject(new Error("照片讀取失敗"));
        reader.readAsDataURL(file);
      });
    }),
  );
}
