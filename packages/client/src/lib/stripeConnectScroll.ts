/** Must match `id` on `MerchantStripeConnectPanel` root. */
export const STRIPE_CONNECT_PANEL_ID = "stripe-connect";

/** Scroll after React Router finishes (hash-only nav restores scroll otherwise). */
export function scrollStripeConnectPanelIntoView(): void {
  const run = () => {
    document.getElementById(STRIPE_CONNECT_PANEL_ID)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };
  queueMicrotask(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(run);
    });
  });
  window.setTimeout(run, 120);
  window.setTimeout(run, 400);
}
