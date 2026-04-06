import { PublicBusinessCard } from "@/components/public/PublicBusinessCard";
import { usePublicBusinessProfile } from "@/hooks/usePublicBusinessProfile";
import { resolveLegalContactEmail } from "@/lib/publicContactEmail";

export function RefundsPage() {
  const businessProfile = usePublicBusinessProfile();
  const email = resolveLegalContactEmail(businessProfile?.businessEmail);

  return (
    <article className="mx-auto max-w-2xl space-y-6 text-sm leading-relaxed">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Refunds</h1>
        <p className="text-muted-foreground">
          Policy for digital goods purchased through this storefront.
        </p>
      </div>

      <PublicBusinessCard profile={businessProfile} />

      <section className="space-y-3">
        <p>
          <strong>All sales are final.</strong> Because products are digital
          goods (music downloads and similar digital content), we do not offer
          refunds once access or files have been delivered or made available.
        </p>
        <p>
          If you believe a charge is incorrect or unauthorized, contact{" "}
          <a
            href={`mailto:${encodeURIComponent(email)}`}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {email}
          </a>{" "}
          with your receipt details so we can review the situation with you.
        </p>
        <p>
          Cardholders may also open a dispute through their bank or card
          network; see Stripe&apos;s overview of how disputes work for buyers
          and sellers at{" "}
          <a
            href="https://stripe.com/docs/disputes"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            stripe.com/docs/disputes
          </a>
          .
        </p>
      </section>
    </article>
  );
}
