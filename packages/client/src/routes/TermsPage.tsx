import { PublicBusinessCard } from "@/components/public/PublicBusinessCard";
import { usePublicBusinessProfile } from "@/hooks/usePublicBusinessProfile";
import { resolveLegalContactEmail } from "@/lib/publicContactEmail";

export function TermsPage() {
  const businessProfile = usePublicBusinessProfile();
  const email = resolveLegalContactEmail(businessProfile?.businessEmail);

  return (
    <article className="mx-auto max-w-2xl space-y-6 text-sm leading-relaxed">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Terms</h1>
        <p className="text-muted-foreground">
          Information about this storefront and how purchases work.
        </p>
      </div>

      <PublicBusinessCard profile={businessProfile} />

      <section className="space-y-3">
        <p>
          Bazaar is a storefront for buying licensed digital music directly
          from artists on the AT Protocol.
        </p>
        <p>
          Items offered for sale are <strong>digital music downloads</strong>{" "}
          (and related digital goods listed in the catalog), delivered after
          payment.
        </p>
        <p>
          Payments are processed by{" "}
          <a
            href="https://stripe.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Stripe
          </a>
          . Card and payment details are handled by Stripe according to its
          terms and privacy policy.
        </p>
        <p>
          These purchases are governed by the laws applicable in the{" "}
          <strong>artist&apos;s or seller&apos;s jurisdiction</strong>. If that
          jurisdiction is not stated on a listing or profile linked from the
          store, it should be treated as{" "}
          <strong>unspecified until the seller confirms</strong>.
        </p>
        <p>
          For questions about this storefront or these terms, contact{" "}
          <a
            href={`mailto:${encodeURIComponent(email)}`}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {email}
          </a>
          .
        </p>
      </section>
    </article>
  );
}
