import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/ui/cn";

/** Standard content section with comfortable measure. */
export function Section({
  children,
  className,
  tone = "plain",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "plain" | "white" | "ivory" | "navy";
  id?: string;
}) {
  const tones = {
    plain: "bg-ivory",
    white: "bg-surface",
    ivory: "bg-ivory-100",
    navy: "bg-ivory-100 text-navy",
  } as const;
  return (
    <section id={id} className={cn("px-4 py-14 sm:px-6 sm:py-20", tones[tone], className)}>
      <div className="mx-auto max-w-6xl">{children}</div>
    </section>
  );
}

/** Centred section heading block. */
export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  tone = "dark",
}: {
  eyebrow?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "center" | "left";
  tone?: "dark" | "light";
}) {
  return (
    <div className={cn("max-w-2xl", align === "center" ? "mx-auto text-center" : "")}>
      {eyebrow && (
        <p
          className={cn(
            "text-xs font-semibold uppercase tracking-[0.14em]",
            tone === "dark" ? "text-champagne-700" : "text-champagne",
          )}
        >
          {eyebrow}
        </p>
      )}
      <h2 className={cn("mt-2 text-2xl font-semibold sm:text-3xl", tone === "light" ? "text-navy" : "text-navy")}>
        {title}
      </h2>
      {description && (
        <p className={cn("mt-3 text-base leading-7", tone === "light" ? "text-navy-800" : "text-muted")}>
          {description}
        </p>
      )}
    </div>
  );
}

/** Hero for inner pages (below the home hero). */
export function PageHero({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-line bg-surface px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-3xl">
          {eyebrow && (
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-champagne-700">{eyebrow}</p>
          )}
          <h1 className="mt-2 text-3xl font-semibold leading-tight text-navy sm:text-4xl">{title}</h1>
          {description && <p className="mt-4 text-lg leading-8 text-muted">{description}</p>}
          {children && <div className="mt-6 flex flex-wrap gap-3">{children}</div>}
        </div>
      </div>
    </div>
  );
}

/** Closing call-to-action band. */
export function CtaBand({
  title = "Start organising what matters.",
  description = "Create your vault in a few minutes. Add records at your own pace, choose your people, and decide the conditions.",
  primary = { href: "/signup", label: "Create your vault" },
  secondary = { href: "/how-it-works", label: "See how it works" },
}: {
  title?: string;
  description?: string;
  primary?: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <Section tone="navy" className="border-t border-line">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-2xl font-semibold text-navy sm:text-3xl">{title}</h2>
        <p className="mt-3 text-base leading-7 text-muted">{description}</p>
        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={primary.href}
            className="cta-gradient inline-flex h-12 w-full items-center justify-center rounded-lg px-6 text-base font-semibold shadow-sm transition-all hover:shadow-glow sm:w-auto"
          >
            {primary.label}
          </Link>
          <Link
            href={secondary.href}
            className="inline-flex h-12 w-full items-center justify-center rounded-lg border border-line-dark px-6 text-base font-medium text-navy transition-colors hover:bg-white/10 sm:w-auto"
          >
            {secondary.label}
          </Link>
        </div>
      </div>
    </Section>
  );
}

/** Simple numbered step list. */
export function StepList({
  steps,
}: {
  steps: { title: string; body: React.ReactNode }[];
}) {
  return (
    <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {steps.map((step, i) => (
        <li key={step.title} className="rounded-card border border-line bg-surface p-5 shadow-card">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-champagne/30 bg-champagne/15 text-sm font-semibold text-champagne-700">
            {i + 1}
          </span>
          <h3 className="mt-3 text-base font-semibold text-navy">{step.title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted">{step.body}</p>
        </li>
      ))}
    </ol>
  );
}

/** Legal document wrapper: sticky table of contents + prose body. */
export function LegalLayout({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: React.ReactNode;
  sections: { id: string; heading: string; body: React.ReactNode }[];
}) {
  return (
    <>
      <div className="border-b border-line bg-surface px-4 py-12 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-3xl font-semibold text-navy">{title}</h1>
          <p className="mt-2 text-sm text-muted">Last updated {updated}</p>
        </div>
      </div>
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[240px_1fr]">
        <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">On this page</p>
          <ul className="mt-3 space-y-2 border-l border-line pl-4">
            {sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="text-sm text-muted transition-colors hover:text-navy"
                >
                  {s.heading}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <article className="prose-basic min-w-0 max-w-3xl">
          <p className="text-base leading-7 text-muted">{intro}</p>
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <h2>{s.heading}</h2>
              {s.body}
            </section>
          ))}
        </article>
      </div>
    </>
  );
}
