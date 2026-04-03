import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAtpSession } from "@/hooks/useAtpSession";

const devMockSignIn =
  import.meta.env.DEV &&
  import.meta.env.VITE_DEV_MOCK_ATPROTO_SIGNIN === "true";

export function MerchantSignInPage() {
  const { signIn } = useAtpSession();
  const [handle, setHandle] = useState("");

  return (
    <div className="mx-auto max-w-md space-y-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {devMockSignIn ? (
            <>
              Development mode: Continue stores a{" "}
              <span className="font-mono text-foreground">local mock session</span>{" "}
              (no OAuth). Use any handle string for display;{" "}
              <span className="font-mono text-foreground">VITE_ARTIST_DID</span>{" "}
              is used as the merchant DID.
            </>
          ) : (
            <>
              Enter your ATProto handle (for example{" "}
              <span className="font-mono text-foreground">you.bsky.social</span>
              ). You will be redirected to your host to authorize Bazaar.
            </>
          )}
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const h = handle.trim();
          if (!h) return;
          signIn(h);
        }}
      >
        <Input
          type="text"
          autoComplete="username"
          placeholder="handle.example.com"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
        />
        <Button type="submit" className="w-full">
          Continue
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
