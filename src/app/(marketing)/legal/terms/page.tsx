import type { Metadata } from "next";
import { LegalLayout } from "@/components/marketing/sections";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The terms under which you use AfterKey, including acceptable use, subscriptions, and disclaimers.",
  alternates: { canonical: "/legal/terms" },
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <LegalLayout
      title="Terms of service"
      updated="19 October 2026"
      intro="These terms form an agreement between you and AfterKey for your use of the service. Please read them carefully — they include important limitations about what AfterKey is and is not."
      sections={[
        {
          id: "acceptance",
          heading: "1. Acceptance of these terms",
          body: (
            <>
              <p>
                By creating an account or using AfterKey, you agree to these terms and our{" "}
                <a href="/legal/privacy">privacy policy</a>. If you do not agree, do not use the
                service. You must be at least 18 years old and able to enter a binding agreement.
              </p>
            </>
          ),
        },
        {
          id: "what-we-are",
          heading: "2. What AfterKey is — and is not",
          body: (
            <>
              <p>
                AfterKey is a digital legacy and personal vault service. We provide tools to store
                information, schedule check-ins, and configure conditional sharing of selected
                content with people you choose.
              </p>
              <p>
                AfterKey is <strong>not</strong> a bank, financial institution, insurer, law firm,
                executor, or government authority. We do not hold funds, provide legal, tax or
                financial advice, certify death or incapacity, guarantee access to any third-party
                account, or replace a will, power of attorney, or the official recovery processes
                of any provider.
              </p>
            </>
          ),
        },
        {
          id: "your-account",
          heading: "3. Your account",
          body: (
            <>
              <p>
                You are responsible for keeping your credentials, recovery phrase and two-factor
                device secure, and for all activity under your account. Notify us promptly at the
                contact page if you suspect unauthorized access.
              </p>
              <p>
                You must provide accurate information, keep your email address current (it is the
                channel for check-in reminders and security notices), and use the service only for
                lawful purposes.
              </p>
            </>
          ),
        },
        {
          id: "acceptable-use",
          heading: "4. Acceptable use",
          body: (
            <ul>
              <li>No unlawful, fraudulent, harassing, or infringing content.</li>
              <li>No attempts to bypass security, rate limits, access controls, or to probe other users' data.</li>
              <li>No malware, scraping that degrades the service, or reverse engineering except where law permits.</li>
              <li>No use that puts minors or vulnerable people at risk, or that facilitates abuse of any person.</li>
            </ul>
          ),
        },
        {
          id: "release-acknowledgement",
          heading: "5. Check-ins and release — explicit acknowledgement",
          body: (
            <>
              <p>
                You understand that if you fail to respond to check-in reminders for the period you
                configured, AfterKey will begin the release process you configured: escalating
                notifications to your recipients, optional identity verification, and disclosure of
                the specific content you selected to the specific recipients you named.
              </p>
              <p>
                You control every input of that configuration and may cancel any pending release at
                any time before completion by signing in. You acknowledge that disclosure, once
                completed for a case, cannot be reversed — content delivered to recipients may have
                been copied by them.
              </p>
              <p>
                AfterKey does not independently establish anyone's death or incapacity and relies
                solely on your configured check-in schedule and any verification steps you enabled.
              </p>
            </>
          ),
        },
        {
          id: "subscriptions",
          heading: "6. Plans, payments and cancellation",
          body: (
            <>
              <p>
                Plan structures are published on our <a href="/pricing">pricing page</a>. Prices
                will be displayed there when billing is configured. If you purchase a paid plan,
                billing is recurring until cancelled, and you may cancel at any time with access
                continuing until the end of the paid period.
              </p>
              <p>
                Free plans remain functional for check-in safety; we do not disable core safety
                controls as a paywall.
              </p>
            </>
          ),
        },
        {
          id: "content",
          heading: "7. Your content",
          body: (
            <>
              <p>
                You retain all rights to content you put in AfterKey. You grant us only the limited
                license needed to operate the service: storing, encrypting, transmitting to
                recipients you authorize, and generating the exports you request.
              </p>
              <p>
                You confirm you have the right to store and share the content you upload, including
                any documents concerning other people.
              </p>
            </>
          ),
        },
        {
          id: "termination",
          heading: "8. Suspension and termination",
          body: (
            <p>
              You may delete your account at any time (subject to a 7-day cancellable grace
              period). We may suspend or terminate accounts that breach these terms, create risk
              for others, or are required to be closed by law — with notice where reasonably
              possible, and with your data handled per the privacy policy.
            </p>
          ),
        },
        {
          id: "disclaimers",
          heading: "9. Disclaimers and limitation of liability",
          body: (
            <>
              <p>
                The service is provided “as is” and “as available”. To the fullest extent permitted
                by law, we disclaim warranties of merchantability, fitness for a particular
                purpose, and non-infringement. We do not warrant that the service will be
                uninterrupted or that any specific recipient will act on information they receive.
              </p>
              <p>
                To the fullest extent permitted by law, AfterKey's aggregate liability arising out
                of or relating to the service will not exceed the amount you paid us in the twelve
                months before the claim, or £100 if you have paid nothing. Nothing here limits
                liability that cannot be limited by law.
              </p>
            </>
          ),
        },
        {
          id: "changes",
          heading: "10. Changes to these terms",
          body: (
            <p>
              We may update these terms; the “last updated” date above reflects the current
              version. Material changes will be notified by email or in-product before they take
              effect. Continued use after the effective date constitutes acceptance.
            </p>
          ),
        },
        {
          id: "law",
          heading: "11. Governing law and contact",
          body: (
            <p>
              These terms are governed by the laws of England and Wales, and its courts have
              exclusive jurisdiction, unless mandatory consumer law in your country of residence
              says otherwise. Questions? Use the <a href="/contact">contact page</a>.
            </p>
          ),
        },
      ]}
    />
  );
}
