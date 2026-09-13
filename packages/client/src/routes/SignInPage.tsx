import { useState } from "react";
import { Link } from "react-router-dom";
import { ActorHandleTypeaheadInput } from "@/components/shared/ActorHandleTypeaheadInput";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAtpSession } from "@/hooks/useAtpSession";

const devMockSignIn =
  import.meta.env.DEV &&
  import.meta.env.VITE_DEV_MOCK_ATPROTO_SIGNIN === "true";

export function SignInPage() {
  const { signIn } = useAtpSession();
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startSignIn(h: string) {
    const trimmed = h.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    signIn(trimmed)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Sign-in failed.");
      })
      .finally(() => setBusy(false));
  }

  return (
    <div className="mx-auto max-w-md space-y-6 py-12 px-4 sm:px-0">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {devMockSignIn ? (
            <>
              Development mode: OAuth disabled. To view the merchant dashboard,
              enter the handle that matches your environment configuration for (
              <span className="font-mono text-foreground">VITE_MERCHANT_DID</span>
              ). Other handles will present the UI available to all other users.
            </>
          ) : (
            <>
              Using your{" "}
              <a
                href="https://atmosphereaccount.com/hosts"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:text-foreground"
              >
                atmosphere account
              </a>
              .
            </>
          )}
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          startSignIn(handle);
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="signin-handle">Handle</Label>
          <ActorHandleTypeaheadInput
            id="signin-handle"
            autoComplete="username"
            placeholder="handle.example.com"
            value={handle}
            onChange={setHandle}
            onSelect={startSignIn}
            disabled={busy}
          />
        </div>
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? (
            <span className="inline-flex items-center gap-2 animate-pulse">
              Signing in…
            </span>
          ) : (
            "Continue"
          )}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        <Link
          to="/"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Back to storefront
        </Link>
      </p>
    </div>
  );
}
