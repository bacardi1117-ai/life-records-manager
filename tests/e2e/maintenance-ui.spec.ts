import { expect, test } from "@playwright/test";

test("maintenance, history and notes typography stays readable without viewport overflow", async ({ page }, testInfo) => {
  await page.goto("./#/items/water-heater");
  await page.getByRole("tab", { name: "定期子項目" }).click();
  await expect(page.locator(".task-info h3").first()).toHaveCSS("font-size", "18px");
  await expect(page.locator(".task-info p").first()).toHaveCSS("font-size", "15px");
  await page.getByRole("tab", { name: "歷史紀錄" }).click();
  await expect(page.locator(".timeline time").first()).toHaveCSS("font-size", "19px");
  await page.locator(".timeline summary").first().click();
  await expect(page.locator(".timeline p").first()).toHaveCSS("font-size", "15px");
  await page.getByRole("tab", { name: "備註" }).click();
  await expect(page.locator(".note p").first()).toHaveCSS("font-size", "16px");
  await expect(page.getByRole("textbox", { name: "新增備註" })).toHaveCSS("font-size", testInfo.project.name === "mobile" ? "16px" : "15px");
  await expect(page.locator(".note-form .primary")).toHaveCSS("font-size", "14px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(1);
  if (testInfo.project.name === "mobile") {
    await page.getByRole("tab", { name: "定期子項目" }).click();
    await expect(page.locator(".cloud-plan")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
