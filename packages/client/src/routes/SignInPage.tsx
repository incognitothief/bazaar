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

  function startSignIn(h: string) {
    const trimmed = h.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    void signIn(trimmed).finally(() => setBusy(false));
  }

  return (
    <div className="mx-auto max-w-md space-y-6 py-12 px-4 sm:px-0">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {devMockSignIn ? (
            <>
              Development mode: no OAuth — your handle is resolved to a DID via{" "}
              <span className="font-mono text-foreground">
                VITE_ATPROTO_SERVICE
              </span>{" "}
              and stored locally. You get the merchant dashboard only if that
              DID matches{" "}
              <span className="font-mono text-foreground">VITE_ARTIST_DID</span>
              , same as production.
            </>
          ) : (
            <>
              Enter your ATProto handle. You will be redirected to your host PDS
              to authorize Bazaar.
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
          <div className="flex gap-2">
            <ActorHandleTypeaheadInput
              id="signin-handle"
              autoComplete="username"
              placeholder="handle.example.com"
              value={handle}
              onChange={setHandle}
              onSelect={startSignIn}
              disabled={busy}
              className="flex-1"
            />
            <Button type="submit" disabled={busy}>
              {busy ? "Resolving…" : "Continue"}
            </Button>
          </div>
        </div>
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
