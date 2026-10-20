/**
 * Payment abstraction layer (see docs/pricing.md).
 *
 * Paid entitlements may only activate after server-side verification of a
 * provider event — never a browser redirect. The application talks to this
 * interface only; a concrete provider (Stripe or another provider verified
 * against the business's country of registration, settlement, currencies,
 * refunds and compliance requirements) plugs in here without touching
 * checkout, webhook or entitlement call sites.
 *
 * Until a provider is configured, `getBillingProvider()` returns the honest
 * unconfigured implementation: every paid operation fails with
 * `billing_not_configured` instead of pretending a payment happened.
 */

export interface CheckoutSessionRequest {
  userId: string;
  planSlug: string;
  /** Billing interval for the plan; plans carry both price points. */
  interval: "monthly" | "annual";
  /** Absolute URL the provider should return the customer to. */
  returnUrl: string;
}

export interface CheckoutSession {
  /** Provider-hosted page to redirect the customer to. */
  url: string;
  /** Opaque provider identifier stored for reconciliation. */
  providerSessionId: string;
}

export interface ProviderSubscription {
  providerCustomerId: string;
  providerSubscriptionId: string;
  status: "active" | "trialing" | "past_due" | "canceled" | "incomplete";
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

/** Verified webhook payload, normalized once per provider event type. */
export type ProviderEvent =
  | { type: "subscription.activated" | "subscription.renewed" | "subscription.past_due" | "subscription.canceled"; subscription: ProviderSubscription }
  | { type: "payment.refunded"; providerSubscriptionId: string; reason?: string };

export interface PaymentProvider {
  readonly name: string;
  /** Create a hosted checkout; the customer completes payment off-app. */
  createCheckout(req: CheckoutSessionRequest): Promise<CheckoutSession>;
  /** Verify the provider's signed webhook payload. Throws on bad signatures. */
  verifyWebhook(rawBody: string, signature: string): ProviderEvent;
  /** Build a customer-portal URL for plan changes and cancellation. */
  createPortalUrl(userId: string, returnUrl: string): Promise<string>;
}

export class BillingNotConfiguredError extends Error {
  readonly code = "billing_not_configured";
  constructor() {
    super(
      "Online billing is not configured yet. The Free plan works fully today; paid plans are provisioned by administrators until a payment provider is connected (docs/pricing.md).",
    );
    this.name = "BillingNotConfiguredError";
  }
}

/** Honest fallback: never fabricates a payment or entitlement. */
class UnconfiguredProvider implements PaymentProvider {
  readonly name = "none";
  async createCheckout(): Promise<CheckoutSession> {
    throw new BillingNotConfiguredError();
  }
  verifyWebhook(): ProviderEvent {
    throw new BillingNotConfiguredError();
  }
  async createPortalUrl(): Promise<string> {
    throw new BillingNotConfiguredError();
  }
}

let cached: PaymentProvider | null = null;

/**
 * Factory: a concrete provider activates only when its credentials are
 * configured (e.g. STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET). Wire the
 * verified implementation here once provider selection is confirmed.
 */
export function getBillingProvider(): PaymentProvider {
  if (cached) return cached;
  // Provider plug-in point: when a verified provider integration lands
  // (docs/pricing.md), construct it here from env credentials (e.g.
  // STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET) — call sites stay unchanged.
  cached = new UnconfiguredProvider();
  return cached;
}

/** Test seam: reset the memoized provider. */
export function resetBillingProvider(): void {
  cached = null;
}
