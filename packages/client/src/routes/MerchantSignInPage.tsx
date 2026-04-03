import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAtpSession } from "@/hooks/useAtpSession";

export function MerchantSignInPage() {
  const { signIn } = useAtpSession();
  const [handle, setHandle] = useState("");

  return (
    <div className="mx-auto max-w-md space-y-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Merchant sign in
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter your ATProto handle (for example{" "}
          <span className="font-mono text-foreground">you.bsky.social</span>).
          You will be redirected to your host to authorize Bazaar.
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
