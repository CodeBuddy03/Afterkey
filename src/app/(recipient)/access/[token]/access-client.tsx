"use client";

import * as React from "react";
import { Download, FileText, Landmark, Mail, MapPin, KeyRound, ShieldCheck } from "lucide-react";
import { api, errorMessage } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, Badge, LoadingState } from "@/components/ui/feedback";

interface DeliveryItem {
  id: string;
  type: string;
  title: string;
}

interface Delivery {
  ownerName: string;
  caseId: string;
  availableAt: string | null;
  items: DeliveryItem[];
}

const TYPE_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  messages: { label: "Message", icon: Mail },
  documents: { label: "Document", icon: FileText },
  financial: { label: "Financial record", icon: Landmark },
  digital: { label: "Digital account", icon: KeyRound },
  properties: { label: "Property", icon: MapPin },
};

/** Fields worth showing per structured record type (labels only, no schema noise). */
const FIELD_LABELS: Record<string, Record<string, string>> = {
  financial: {
    institution: "Institution",
    nickname: "Account name",
    accountNumberLast4: "Account (last 4)",
    claimInstructions: "Claim instructions",
    notes: "Notes",
  },
  digital: {
    serviceName: "Service",
    username: "Username",
    url: "Website",
    recoveryInstructions: "Recovery instructions",
    notes: "Notes",
  },
  properties: {
    name: "Property",
    address: "Address",
    emergencyInstructions: "Emergency instructions",
  },
};

/**
 * Delivery viewer for a released package. Every item shown was selected by the
 * sender before their death or incapacity, limited to what they granted to
 * this recipient and what their release policy allowed — the token cannot
 * reach anything else.
 */
export function AccessClient({ token }: { token: string }) {
  const [delivery, setDelivery] = React.useState<Delivery | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [openItem, setOpenItem] = React.useState<string | null>(null);
  const [itemData, setItemData] = React.useState<Record<string, unknown> | null>(null);
  const [itemError, setItemError] = React.useState<string | null>(null);
  const [loadingItem, setLoadingItem] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await api.get<Delivery>(`/api/access/${encodeURIComponent(token)}`, { signal: controller.signal });
        if (!controller.signal.aborted) setDelivery(res);
      } catch (err) {
        if (!controller.signal.aborted && !(err instanceof DOMException && err.name === "AbortError")) {
          setError(errorMessage(err));
        }
      }
    })();
    return () => controller.abort();
  }, [token]);

  async function open(itemId: string) {
    if (openItem === itemId) {
      setOpenItem(null);
      setItemData(null);
      return;
    }
    setOpenItem(itemId);
    setItemData(null);
    setItemError(null);
    setLoadingItem(true);
    try {
      const res = await api.get<{ item: { content: Record<string, unknown> } }>(
        `/api/access/${encodeURIComponent(token)}/items/${itemId}`,
      );
      setItemData(res.item.content);
    } catch (err) {
      setItemError(errorMessage(err));
    } finally {
      setLoadingItem(false);
    }
  }

  if (!delivery && !error) {
    return <LoadingState label="Opening what was shared with you…" />;
  }

  if (error && !delivery) {
    return (
      <Card>
        <CardBody>
          <Alert tone="error" title="This link does not work">
            {error}
          </Alert>
        </CardBody>
      </Card>
    );
  }

  if (!delivery) return null;

  return (
    <Card>
      <CardHeader
        title={`Content from ${delivery.ownerName}`}
        description={
          delivery.availableAt
            ? `Released ${new Date(delivery.availableAt).toLocaleString()}. This link stays valid for 7 days from the release email.`
            : undefined
        }
        actions={
          <Badge tone="navy">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            {delivery.items.length} item{delivery.items.length === 1 ? "" : "s"}
          </Badge>
        }
      />
      <CardBody className="space-y-3">
        <Alert tone="info">
          {delivery.ownerName} chose to share exactly these items with you in advance. Nothing else from their vault
          is accessible through this page. If anything here concerns you, reach out to your contact or their family.
        </Alert>
        {delivery.items.length === 0 && (
          <p className="text-sm text-muted">There are no items in this delivery.</p>
        )}
        <ul className="divide-y divide-line">
          {delivery.items.map((item) => {
            const meta = TYPE_META[item.type] ?? { label: item.type, icon: FileText };
            const Icon = meta.icon;
            const isOpen = openItem === item.id;
            return (
              <li key={item.id}>
                <div className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-50 text-navy" aria-hidden="true">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-navy">{item.title}</p>
                      <p className="text-xs text-muted">{meta.label}</p>
                    </div>
                  </div>
                  {item.type === "documents" ? (
                    <a
                      href={`/api/access/${encodeURIComponent(token)}/items/${item.id}`}
                      data-interactive
                      className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-navy underline decoration-champagne underline-offset-4"
                    >
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Download
                    </a>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => void open(item.id)} aria-expanded={isOpen}>
                      {isOpen ? "Close" : "View"}
                    </Button>
                  )}
                </div>
                {isOpen && (
                  <div className="mb-3 rounded-lg border border-line bg-ivory-50 px-4 py-3">
                    {loadingItem && <p className="text-sm text-muted">Opening…</p>}
                    {itemError && (
                      <Alert tone="error" role="alert">
                        {itemError}
                      </Alert>
                    )}
                    {itemData && (
                      <ItemContent type={item.type} content={itemData} />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

function ItemContent({ type, content }: { type: string; content: Record<string, unknown> }) {
  if (type === "messages") {
    return (
      <div className="space-y-2">
        {typeof content.body === "string" && (
          <p className="whitespace-pre-line text-sm leading-7 text-charcoal">{content.body}</p>
        )}
        {typeof content.scheduledFor === "string" && (
          <p className="text-xs text-muted">Written for a future moment: {new Date(content.scheduledFor).toLocaleString()}</p>
        )}
      </div>
    );
  }

  const labels = FIELD_LABELS[type] ?? {};
  const entries = Object.entries(content).filter(
    ([k, v]) =>
      labels[k] &&
      v !== null &&
      v !== undefined &&
      v !== "" &&
      !["id", "vaultId", "createdAt", "updatedAt"].includes(k),
  );
  if (entries.length === 0) {
    return <p className="text-sm text-muted">No additional details were included with this item.</p>;
  }
  return (
    <dl className="space-y-2">
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{labels[k]}</dt>
          <dd className="mt-0.5 whitespace-pre-line text-sm leading-6 text-charcoal">
            {typeof v === "string" ? v : JSON.stringify(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
