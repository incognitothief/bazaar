import type { PublicBusinessProfile } from "@/hooks/usePublicBusinessProfile";

type Props = {
  profile: PublicBusinessProfile | null;
};

export function PublicBusinessCard({ profile }: Props) {
  if (!profile) return null;
  const { businessName, businessState, businessEmail } = profile;
  if (!businessName && !businessState && !businessEmail) return null;

  const initial =
    businessName?.trim().charAt(0).toUpperCase() ||
    businessEmail?.trim().charAt(0).toUpperCase() ||
    "?";

  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-3"
      aria-label="Seller business details"
    >
      <span
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground ring-1 ring-border"
        aria-hidden
      >
        {initial}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs font-medium text-muted-foreground">Business</p>
        {businessName ? (
          <p className="truncate text-sm font-medium text-foreground">
            {businessName}
          </p>
        ) : null}
        {businessState ? (
          <p className="truncate text-sm text-muted-foreground">{businessState}</p>
        ) : null}
        {businessEmail ? (
          <p className="text-sm">
            <a
              href={`mailto:${encodeURIComponent(businessEmail)}`}
              className="break-all font-mono text-xs text-primary underline-offset-2 hover:underline"
            >
              {businessEmail}
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}
