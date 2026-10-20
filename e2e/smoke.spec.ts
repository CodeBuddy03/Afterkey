import { expect, test } from "@playwright/test";

test.describe("marketing site", () => {
  test("landing renders brand and main navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/AfterKey/i);

    const mainNav = page.getByRole("navigation", { name: "Main" });
    await expect(mainNav.getByRole("link", { name: "How it works" })).toBeVisible();
    await expect(mainNav.getByRole("link", { name: "Security" })).toBeVisible();

    await mainNav.getByRole("link", { name: "Pricing" }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("pricing lists the plans seeded by migrations", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText("AfterKey Plus", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("AfterKey Family", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Annual is the default; switch to monthly and verify the real DB prices.
    await expect(page.getByText("$39", { exact: false }).first()).toBeVisible();
    await page.getByRole("radio", { name: "Monthly" }).click();
    await expect(page.getByText("$4.99", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("$9.99", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Billed monthly", { exact: false }).first()).toBeVisible();
  });

  test("auth entry points render", async ({ page }) => {
    await page.goto("/signin");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();

    await page.goto("/signup");
    await expect(page.getByRole("button", { name: "Create your vault" })).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("signed-out users are redirected away from app routes", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/signin/);
    await page.goto("/checkins");
    await expect(page).toHaveURL(/\/signin/);
  });
});
