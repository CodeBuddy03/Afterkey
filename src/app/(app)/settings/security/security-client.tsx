"use client";

import * as React from "react";
import { Copy, KeyRound, LogOut, ShieldCheck, Smartphone } from "lucide-react";
import { api, errorMessage, fieldErrors } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader, PageHeader } from "@/components/ui/card";
import { Alert, Badge, SaveStatus, type SaveState } from "@/components/ui/feedback";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/inputs";

interface Session {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  revokedAt: string | null;
  current: boolean;
}

interface Device {
  id: string;
  deviceName: string | null;
  trustedAt: string;
  lastUsedAt: string;
  revokedAt: string | null;
}

/** Security settings: password, two-factor, recovery phrase and sessions. */
export function SecurityClient() {
  const [mfaEnabled, setMfaEnabled] = React.useState<boolean | null>(null);
  const [recovery, setRecovery] = React.useState<{ configured: boolean; createdAt?: string; phraseBits?: number } | null>(null);
  const [sessions, setSessions] = React.useState<Session[] | null>(null);
  const [devices, setDevices] = React.useState<Device[]>([]);
  const [currentSessionId, setCurrentSessionId] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoadError(null);
    try {
      const [profile, rec, sess] = await Promise.all([
        api.get<{ profile: { mfaEnabled: boolean } }>("/api/account/profile"),
        api.get<{ configured: boolean; createdAt?: string; phraseBits?: number }>("/api/account/recovery"),
        api.get<{ sessions: Session[]; devices: Device[]; currentSessionId: string }>("/api/account/sessions"),
      ]);
      if (signal?.aborted) return;
      setMfaEnabled(profile.profile.mfaEnabled);
      setRecovery(rec);
      setSessions(sess.sessions ?? []);
      setDevices((sess.devices ?? []).map((d) => ({ ...d, trustedAt: (d as { trustedAt?: string }).trustedAt ?? "" })));
      setCurrentSessionId(sess.currentSessionId);
    } catch (err) {
      if (!signal?.aborted) setLoadError(errorMessage(err));
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function revokeSession(sessionId: string) {
    try {
      await api.delete("/api/account/sessions", { body: { sessionId } });
      await load();
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }

  async function revokeOthers() {
    try {
      await api.delete("/api/account/sessions", { body: { all: true } });
      await load();
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }

  async function revokeDevice(deviceId: string) {
    try {
      await api.delete("/api/account/sessions", { body: { deviceId } });
      await load();
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }

  return (
    <>
      <PageHeader
        title="Security settings"
        description="Password, two-factor authentication, your recovery phrase and every session signed in to this account."
      />
      {loadError && (
        <Alert tone="error" className="mb-4">
          {loadError}
        </Alert>
      )}
      <div className="grid gap-5">
        <PasswordCard />
        <MfaCard enabled={mfaEnabled} onChanged={() => void load()} />
        <RecoveryCard recovery={recovery} onChanged={() => void load()} />
        <SessionsCard
          sessions={sessions}
          devices={devices}
          currentSessionId={currentSessionId}
          onRevoke={revokeSession}
          onRevokeOthers={revokeOthers}
          onRevokeDevice={revokeDevice}
        />
      </div>
    </>
  );
}

/* ------------------------------- Password ------------------------------- */

function PasswordCard() {
  const [currentPassword, setCurrent] = React.useState("");
  const [newPassword, setNew] = React.useState("");
  const [confirmPassword, setConfirm] = React.useState("");
  const [state, setState] = React.useState<SaveState>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  async function submit() {
    setState("saving");
    setError(null);
    setErrors({});
    try {
      await api.post("/api/account/password", { currentPassword, newPassword });
      setState("saved");
      setCurrent("");
      setNew("");
      setConfirm("");
    } catch (err) {
      setState("error");
      setError(errorMessage(err));
      setErrors(fieldErrors(err));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Password"
        description="Changing your password signs out every other session immediately."
      />
      <CardBody className="grid gap-4 sm:grid-cols-2">
        <Field label="Current password" required error={errors.currentPassword}>
          <Input
            type="password"
            value={currentPassword}
            onChange={(e) => {
              setCurrent(e.target.value);
              setState("unsaved");
            }}
            autoComplete="current-password"
          />
        </Field>
        <div className="contents">
          <Field label="New password" required error={errors.newPassword}>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNew(e.target.value);
                setState("unsaved");
              }}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm new password" required error={mismatch ? "Passwords do not match." : undefined}>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirm(e.target.value);
                setState("unsaved");
              }}
              autoComplete="new-password"
            />
          </Field>
        </div>
      </CardBody>
      <CardFooter>
        <Button onClick={submit} disabled={!currentPassword || !newPassword || mismatch} loading={state === "saving"}>
          Update password
        </Button>
        <SaveStatus state={state} error={error} />
      </CardFooter>
    </Card>
  );
}

/* --------------------------------- 2FA --------------------------------- */

function MfaCard({ enabled, onChanged }: { enabled: boolean | null; onChanged: () => void }) {
  const [phase, setPhase] = React.useState<"idle" | "setup" | "backups">("idle");
  const [secret, setSecret] = React.useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = React.useState("");
  const [backupCodes, setBackupCodes] = React.useState<string[]>([]);
  const [disableOpen, setDisableOpen] = React.useState(false);
  const [state, setState] = React.useState<SaveState>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  async function beginSetup() {
    setState("saving");
    setError(null);
    try {
      const res = await api.post<{ secret: string; otpauth: string }>("/api/account/mfa");
      setSecret(res);
      setPhase("setup");
      setState("idle");
    } catch (err) {
      setState("error");
      setError(errorMessage(err));
    }
  }

  async function confirmSetup() {
    setState("saving");
    setError(null);
    setErrors({});
    try {
      const res = await api.patch<{ backupCodes: string[] }>("/api/account/mfa", { code });
      setBackupCodes(res.backupCodes ?? []);
      setPhase("backups");
      setState("saved");
      onChanged();
    } catch (err) {
      setState("error");
      setError(errorMessage(err));
      setErrors(fieldErrors(err));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Two-factor authentication"
        description="An authenticator app adds a second step at sign-in. Strongly recommended."
        actions={
          enabled === null ? null : enabled ? (
            <Badge tone="success">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              Enabled
            </Badge>
          ) : (
            <Badge tone="neutral">Disabled</Badge>
          )
        }
      />
      <CardBody className="space-y-4">
        {phase === "setup" && secret && (
          <>
            <Alert tone="info">
              Add this to your authenticator app (Google Authenticator, 1Password, Authy…). Enter the 6-digit code it
              shows to confirm.
            </Alert>
            <Field label="Manual entry key" description="Tap “can’t scan?” in your app and paste this key.">
              <div className="flex gap-2">
                <Input readOnly value={secret.secret} aria-label="Two-factor secret" />
                <Button
                  variant="secondary"
                  onClick={() => void navigator.clipboard?.writeText(secret.secret)}
                  aria-label="Copy secret"
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </Field>
            <Field label="Enter the 6-digit code" required error={errors.code}>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="max-w-[12rem] tracking-widest"
              />
            </Field>
          </>
        )}
        {phase === "backups" && (
          <>
            <Alert tone="warn" title="Store these backup codes now — they are shown only once.">
              Each code replaces a lost authenticator app, once.
            </Alert>
            <ul className="grid grid-cols-2 gap-2 font-mono text-sm text-navy">
              {backupCodes.map((c) => (
                <li key={c} className="rounded border border-line bg-ivory-50 px-2 py-1">
                  {c}
                </li>
              ))}
            </ul>
          </>
        )}
        {phase === "idle" && enabled === false && (
          <p className="text-sm leading-6 text-muted">
            Without two-factor, anyone who knows your password can open your vault. Setting it up takes about a minute.
          </p>
        )}
        {state === "error" && error && (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        )}
      </CardBody>
      <CardFooter>
        {phase === "idle" &&
          (enabled ? (
            <Button variant="secondary" onClick={() => setDisableOpen(true)}>
              Disable two-factor
            </Button>
          ) : (
            <Button onClick={beginSetup} loading={state === "saving"}>
              <Smartphone className="h-4 w-4" aria-hidden="true" />
              Set up two-factor
            </Button>
          ))}
        {phase === "setup" && (
          <>
            <Button onClick={confirmSetup} disabled={code.length !== 6} loading={state === "saving"}>
              Confirm and enable
            </Button>
            <Button variant="ghost" onClick={() => setPhase("idle")}>
              Cancel
            </Button>
          </>
        )}
        {phase === "backups" && (
          <Button
            variant="secondary"
            onClick={() => {
              setPhase("idle");
              setCode("");
              onChanged();
            }}
          >
            I saved my backup codes
          </Button>
        )}
      </CardFooter>
      <DisableMfaDialog
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        onDisabled={() => {
          setDisableOpen(false);
          onChanged();
        }}
      />
    </Card>
  );
}

function DisableMfaDialog({ open, onClose, onDisabled }: { open: boolean; onClose: () => void; onDisabled: () => void }) {
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [state, setState] = React.useState<SaveState>("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setPassword("");
      setCode("");
      setState("idle");
      setError(null);
    }
  }, [open]);

  async function submit() {
    setState("saving");
    setError(null);
    try {
      await api.delete("/api/account/mfa", { body: { password, code } });
      setState("saved");
      onDisabled();
    } catch (err) {
      setState("error");
      setError(errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Disable two-factor authentication" description="Your account will only be protected by your password.">
      <div className="space-y-4">
        <Field label="Password" required>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="Current 6-digit code" required>
          <Input
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="max-w-[12rem] tracking-widest"
          />
        </Field>
        {state === "error" && error && (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        )}
        <div className="flex gap-3">
          <Button variant="danger" onClick={submit} disabled={!password || code.length !== 6} loading={state === "saving"}>
            Disable two-factor
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Keep it enabled
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------ Recovery ------------------------------ */

function RecoveryCard({
  recovery,
  onChanged,
}: {
  recovery: { configured: boolean; createdAt?: string; phraseBits?: number } | null;
  onChanged: () => void;
}) {
  const [phase, setPhase] = React.useState<"idle" | "generate" | "confirm">("idle");
  const [phrase, setPhrase] = React.useState("");
  const [entered, setEntered] = React.useState("");
  const [revokeOpen, setRevokeOpen] = React.useState(false);
  const [state, setState] = React.useState<SaveState>("idle");
  const [error, setError] = React.useState<string | null>(null);

  async function generate() {
    setState("saving");
    setError(null);
    try {
      const res = await api.post<{ phrase: string }>("/api/account/recovery");
      setPhrase(res.phrase);
      setPhase("confirm");
      setState("idle");
    } catch (err) {
      setState("error");
      setError(errorMessage(err));
    }
  }

  async function confirm() {
    setState("saving");
    setError(null);
    try {
      await api.patch("/api/account/recovery", { phrase: entered.trim() });
      setState("saved");
      setPhase("idle");
      setPhrase("");
      setEntered("");
      onChanged();
    } catch (err) {
      setState("error");
      setError(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader
        title="Recovery phrase"
        description="A 24-word phrase generated on your device. It is the only way back into your encrypted vault if you lose your password — AfterKey cannot reset it for you."
        actions={
          recovery === null ? null : recovery.configured ? (
            <Badge tone="success">Configured</Badge>
          ) : (
            <Badge tone="warn">Not configured</Badge>
          )
        }
      />
      <CardBody className="space-y-4">
        {phase === "idle" && !recovery?.configured && (
          <Alert tone="warn">
            Without a recovery phrase, a forgotten password means your vault is permanently unreadable — even to us.
            Write the phrase on paper; never store it digitally.
          </Alert>
        )}
        {phase === "generate" && (
          <Alert tone="info">
            Your phrase will be generated on this device and shown once. Confirm it on the next step.
          </Alert>
        )}
        {phase === "confirm" && (
          <>
            <Alert tone="warn" title="Write this down now — it is shown only once.">
              Anyone with this phrase can decrypt your vault. Never share it and never type it into any website.
            </Alert>
            <p className="rounded-lg border border-line bg-ivory-50 p-4 font-mono text-sm leading-7 text-navy select-all">
              {phrase}
            </p>
            <Field label="Type the phrase back to confirm" description="Re-typing proves you saved it.">
              <Input value={entered} onChange={(e) => setEntered(e.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
          </>
        )}
        {recovery?.configured && phase === "idle" && (
          <p className="text-sm text-muted">
            Configured{recovery.createdAt ? ` on ${new Date(recovery.createdAt).toLocaleDateString()}` : ""}. Keep your
            written copy somewhere only you can reach.
          </p>
        )}
        {state === "error" && error && (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        )}
      </CardBody>
      <CardFooter>
        {phase === "idle" && (
          <>
            {!recovery?.configured ? (
              <Button onClick={() => (phrase ? setPhase("confirm") : void generate())} loading={state === "saving"}>
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                Generate recovery phrase
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setRevokeOpen(true)}>
                Revoke recovery phrase
              </Button>
            )}
          </>
        )}
        {phase === "generate" && (
          <Button onClick={() => setPhase("confirm")} variant="secondary">
            I am ready — show my phrase
          </Button>
        )}
        {phase === "confirm" && (
          <>
            <Button onClick={confirm} disabled={entered.trim().split(/\s+/).length < 12} loading={state === "saving"}>
              Confirm recovery phrase
            </Button>
            <Button variant="ghost" onClick={() => setPhase("idle")}>
              Cancel
            </Button>
          </>
        )}
        <SaveStatus state={state} error={error} />
      </CardFooter>
      <RevokeRecoveryDialog
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        onRevoked={() => {
          setRevokeOpen(false);
          onChanged();
        }}
      />
    </Card>
  );
}

function RevokeRecoveryDialog({ open, onClose, onRevoked }: { open: boolean; onClose: () => void; onRevoked: () => void }) {
  const [password, setPassword] = React.useState("");
  const [state, setState] = React.useState<SaveState>("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setPassword("");
      setState("idle");
      setError(null);
    }
  }, [open]);

  async function submit() {
    setState("saving");
    setError(null);
    try {
      await api.delete("/api/account/recovery", { body: { password } });
      setState("saved");
      onRevoked();
    } catch (err) {
      setState("error");
      setError(errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Revoke recovery phrase" description="You will need to generate a new one to stay protected.">
      <div className="space-y-4">
        <Alert tone="warn">If you lose your password afterwards, your vault cannot be recovered by anyone.</Alert>
        <Field label="Password" required>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        {state === "error" && error && (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        )}
        <div className="flex gap-3">
          <Button variant="danger" onClick={submit} disabled={!password} loading={state === "saving"}>
            Revoke phrase
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Keep my phrase
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------ Sessions ------------------------------ */

function SessionsCard({
  sessions,
  devices,
  currentSessionId,
  onRevoke,
  onRevokeOthers,
  onRevokeDevice,
}: {
  sessions: Session[] | null;
  devices: Device[];
  currentSessionId: string | null;
  onRevoke: (id: string) => Promise<void> | void;
  onRevokeOthers: () => Promise<void> | void;
  onRevokeDevice: (id: string) => Promise<void> | void;
}) {
  const active = (sessions ?? []).filter((s) => !s.revokedAt);
  const others = active.filter((s) => s.id !== currentSessionId);

  return (
    <Card>
      <CardHeader
        title="Sessions & devices"
        description="Every browser signed in to your account. Revoke anything you do not recognise."
        actions={
          others.length > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => void onRevokeOthers()}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out all others
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-4">
        {sessions === null ? (
          <p className="text-sm text-muted">Loading sessions…</p>
        ) : active.length === 0 ? (
          <p className="text-sm text-muted">No active sessions.</p>
        ) : (
          <ul className="divide-y divide-line">
            {active.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-navy">
                    {s.current ? "This device" : "Other device"}
                    {s.userAgent && <span className="ml-2 font-normal text-muted">· {s.userAgent.slice(0, 60)}</span>}
                  </p>
                  <p className="text-xs text-muted">
                    Signed in {new Date(s.createdAt).toLocaleString()} · last seen {new Date(s.lastSeenAt).toLocaleString()}
                  </p>
                </div>
                {s.current ? (
                  <Badge tone="navy">Current</Badge>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => void onRevoke(s.id)}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {devices.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-navy">Trusted devices</h3>
            <ul className="divide-y divide-line">
              {devices
                .filter((d) => !d.revokedAt)
                .map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-navy">{d.deviceName ?? "Unnamed device"}</p>
                      <p className="text-xs text-muted">Last used {new Date(d.lastUsedAt).toLocaleString()}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => void onRevokeDevice(d.id)}>
                      Revoke
                    </Button>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
