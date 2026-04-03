import { useState } from "react";
import { Link } from "react-router-dom";
import { ActorHandleTypeaheadInput } from "@/components/shared/ActorHandleTypeaheadInput";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAtpSession } from "@/hooks/useAtpSession";

const devMockSignIn =
  import.meta.env.DEV &&
  import.meta.env.VITE_DEV_MOCK_ATPROTO_SIGNIN === "true";

export function MerchantSignInPage() {
  const { signIn } = useAtpSession();
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);

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
              Enter your ATProto handle (for example{" "}
              <span className="font-mono text-foreground">you.bsky.social</span>
              ). You will be redirected to your host to authorize Bazaar. After
              OAuth, you are a merchant only if your account DID equals{" "}
              <span className="font-mono text-foreground">VITE_ARTIST_DID</span>.
            </>
          )}
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const h = handle.trim();
          if (!h || busy) return;
          setBusy(true);
          void signIn(h).finally(() => setBusy(false));
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
            disabled={busy}
          />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Resolving…" : "Continue"}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        <Link to="/" className="underline underline-offset-4 hover:text-foreground">
          Back to storefront
        </Link>
      </p>
    </div>
  );
}
