import { expect, test } from "@playwright/test";

/** Runs under the `mobile` project (iPhone 13). */
test.describe("mobile experience", () => {
  test("landing renders with brand and no horizontal overflow", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[aria-label="AfterKey — home"]').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("mobile menu opens and exposes navigation", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    const nav = page.getByRole("navigation", { name: "Mobile" });
    await expect(nav.getByRole("link", { name: "How it works" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("signup form fits and is usable on a small viewport", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create your vault" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
