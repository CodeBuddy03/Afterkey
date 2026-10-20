import { describe, expect, it } from "vitest";
import { BillingNotConfiguredError, getBillingProvider, resetBillingProvider } from "@/lib/billing/provider";

describe("payment abstraction", () => {
  it("returns the honest unconfigured provider — never a fake payment", async () => {
    resetBillingProvider();
    const provider = getBillingProvider();
    expect(provider.name).toBe("none");

    await expect(
      provider.createCheckout({ userId: "u", planSlug: "personal", interval: "annual", returnUrl: "http://x" }),
    ).rejects.toMatchObject({ code: "billing_not_configured" });
    await expect(provider.createPortalUrl("u", "http://x")).rejects.toMatchObject({
      code: "billing_not_configured",
    });
    expect(() => provider.verifyWebhook("{}", "sig")).toThrow(BillingNotConfiguredError);
  });

  it("memoizes the provider instance", () => {
    resetBillingProvider();
    expect(getBillingProvider()).toBe(getBillingProvider());
  });
});
