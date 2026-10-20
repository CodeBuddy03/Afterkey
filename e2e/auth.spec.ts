import { expect, test } from "@playwright/test";

/**
 * Full authentication lifecycle against the real HTTP app and the
 * afterkey_e2e database: register → confirm email through the delivered
 * message (test mailbox) → sign in → sign out → route protection.
 */
test.describe("authentication lifecycle", () => {
  test.beforeAll(async () => {
    // Warm the routes the lifecycle touches so the dev server compiles them
    // up-front instead of racing navigations inside the test. Parallel: a cold
    // .next cache makes sequential warm-up slower than the hook timeout.
    test.setTimeout(180_000);
    const base = `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}`;
    const paths = [
      "/signup",
      "/signin",
      "/verify-email",
      "/onboarding",
      "/dashboard",
      "/api/auth/register",
      "/api/auth/login",
      "/api/auth/verify-email",
      "/api/auth/logout",
      "/api/test/mailbox",
    ];
    await Promise.all(paths.map((path) => fetch(base + path).catch(() => undefined)));
  });

  test("sign up, confirm email via delivered link, sign in, sign out", async ({ page, request }) => {
    // The full lifecycle touches many routes; allow extra time for first-hit
    // compiles on slow machines even after warm-up.
    test.setTimeout(180_000);
    const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
    const password = "E2e-Vault-9182!";

    // 1. Register.
    await page.goto("/signup");
    await page.getByLabel("Full name").fill("E2E Tester");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("checkbox", { name: /I agree to the/i }).check();
    await page.getByRole("button", { name: "Create your vault" }).click();
    await expect(page).toHaveURL(/\/signin\?email=/, { timeout: 30_000 });

    // 2. The verification message really left the system (file email adapter).
    const mail = await request.get(`/api/test/mailbox?to=${encodeURIComponent(email)}&template=verify_email`);
    expect(mail.ok()).toBe(true);
    const payload = (await mail.json()) as {
      data: { messages: Array<{ text: string; html: string; link: string | null }> };
    };
    expect(payload.data.messages.length).toBeGreaterThan(0);
    const message = payload.data.messages[0]!;
    const raw = `${message.text}\n${message.html}\n${message.link ?? ""}`;
    const tokenMatch = /verify-email\?token=([A-Za-z0-9_\-.]+)/.exec(raw);
    expect(tokenMatch, "verification link must appear in the delivered email").not.toBeNull();

    // 3. Follow the link the way a recipient would.
    await page.goto(`/verify-email?token=${tokenMatch![1]}`);
    await expect(page.getByRole("heading", { name: /email confirmed|already confirmed/i })).toBeVisible();

    // 4. Sign in with the confirmed account.
    await page.goto("/signin");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Set up your vault" })).toBeVisible();

    // 5. Sign out returns to the sign-in page.
    await page.getByRole("button", { name: "Sign out" }).first().click();
    await expect(page).toHaveURL(/\/signin/, { timeout: 30_000 });

    // 6. The app stays protected after logout.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/signin/);
  });

  test("rejects a wrong password with a clear error", async ({ page }) => {
    await page.goto("/signin");
    await page.getByLabel("Email address").fill(`nobody-${Date.now()}@example.test`);
    await page.getByLabel("Password").fill("Wrong-Password-77");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.getByText(/email or password is incorrect/i)).toBeVisible();
    await expect(page).toHaveURL(/\/signin/);
  });
});
