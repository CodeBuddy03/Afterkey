import type { Metadata } from "next";
import { Mail, LifeBuoy, MessageSquare, ShieldAlert } from "lucide-react";
import { PageHero, Section } from "@/components/marketing/sections";
import { ContactForm } from "@/components/marketing/contact-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Contact us",
  description: "Reach the AfterKey team with questions about your account, security, or the product.",
  alternates: { canonical: "/contact" },
  robots: { index: true, follow: true },
};

const CHANNELS = [
  {
    icon: Mail,
    title: "General enquiries",
    body: "Product questions, feedback, and anything that doesn't fit elsewhere. We reply to the address you leave below.",
  },
  {
    icon: LifeBuoy,
    title: "Account & billing support",
    body: "Sign-in trouble, export requests, plan questions. Include the email on your account — never your password.",
  },
  {
    icon: ShieldAlert,
    title: "Security reports",
    body: "Found a vulnerability? Tell us here with the word “security” in the subject. We acknowledge reports promptly and won't pursue good-faith research.",
  },
];

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Talk to a person"
        description="No chatbot maze: every message below lands with the team, and a human replies."
      />

      <Section tone="white">
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <Card>
            <CardHeader title="Send us a message" description="All fields are required unless marked optional." />
            <CardBody>
              <ContactForm />
            </CardBody>
          </Card>

          <div className="space-y-4">
            {CHANNELS.map((c) => (
              <div key={c.title} className="rounded-card border border-line bg-ivory-100/60 p-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface text-navy shadow-sm">
                    <c.icon size={16} aria-hidden="true" />
                  </span>
                  <h2 className="text-sm font-semibold text-navy">{c.title}</h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted">{c.body}</p>
              </div>
            ))}
            <div className="rounded-card border border-line bg-surface p-4 shadow-card">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-50 text-navy">
                  <MessageSquare size={16} aria-hidden="true" />
                </span>
                <h2 className="text-sm font-semibold text-navy">Before you write</h2>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted">
                Our <a href="/faq" className="font-medium text-navy underline decoration-champagne underline-offset-4">FAQ</a>{" "}
                and <a href="/help" className="font-medium text-navy underline decoration-champagne underline-offset-4">help centre</a>{" "}
                answer most questions instantly — including check-in scheduling, cancellation and account recovery.
              </p>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
