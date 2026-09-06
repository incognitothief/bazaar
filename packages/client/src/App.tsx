import {
  Navigate,
  RouterProvider,
  createBrowserRouter,
} from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { Toaster } from "sonner";
import { AtpSessionProvider } from "@/hooks/useAtpSession";
import { PublicLayout } from "@/routes/PublicLayout";
import { HomePage } from "@/routes/HomePage";
import { ItemDetailPage } from "@/routes/ItemDetailPage";
import { LicenseInspectorPage } from "@/routes/LicenseInspectorPage";
import { PurchaseDetailPage } from "@/routes/PurchaseDetailPage";
import { PurchaseSuccessPage } from "@/routes/PurchaseSuccessPage";
import { MerchantLayout } from "@/routes/MerchantLayout";
import { DashboardPage } from "@/routes/DashboardPage";
import { CustomerDashboardPage } from "./routes/CustomerDashboardPage";
import { MerchantInventoryPage } from "@/routes/MerchantInventoryPage";
import { MerchantInventoryEditPage } from "@/routes/MerchantInventoryEditPage";
import { AddProductPage } from "@/routes/AddProductPage";
import { MerchantProductDetailPage } from "@/routes/MerchantProductDetailPage";
import { UploadTracksPage } from "@/routes/UploadTracksPage";
import { UploadPhysicalPage } from "@/routes/UploadPhysicalPage";
import { CreateListingPage } from "@/routes/CreateListingPage";
import { LicensePage } from "@/routes/LicensePage";
import { SettingsPage } from "@/routes/SettingsPage";
import { MerchantTransactionsPage } from "@/routes/MerchantTransactionsPage";
import { SignInPage } from "@/routes/SignInPage";
import { TermsPage } from "@/routes/TermsPage";
import { RefundsPage } from "@/routes/RefundsPage";

const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/terms", element: <TermsPage /> },
      { path: "/refunds", element: <RefundsPage /> },
      { path: "/item/:rkey/:slug", element: <ItemDetailPage /> },
      { path: "/item/:rkey", element: <ItemDetailPage /> },
      { path: "/license/:cid", element: <LicenseInspectorPage /> },
      { path: "/purchase/success", element: <PurchaseSuccessPage /> },
      { path: "/merchant/signin", element: <SignInPage /> },
      { path: "/dashboard", element: <CustomerDashboardPage /> },
      {
        path: "/dashboard/purchase/:receiptUri",
        element: <PurchaseDetailPage />,
      },
    ],
  },
  {
    path: "/merchant",
    element: <MerchantLayout />,
    children: [
      { index: true, element: <Navigate to="dashboard" replace /> },
      { path: "dashboard", element: <DashboardPage /> },
      {
        path: "upload/digital",
        element: <Navigate to="/merchant/upload/tracks" replace />,
      },
      { path: "inventory", element: <MerchantInventoryPage /> },
      { path: "inventory/new", element: <AddProductPage /> },
      { path: "inventory/products", element: <MerchantProductDetailPage /> },
      {
        path: "inventory/edit",
        element: <MerchantInventoryEditPage />,
      },
      { path: "upload/tracks", element: <UploadTracksPage /> },
      { path: "upload/physical", element: <UploadPhysicalPage /> },
      {
        path: "listings",
        element: <Navigate to="/merchant/inventory" replace />,
      },
      { path: "listings/new", element: <CreateListingPage /> },
      { path: "license", element: <LicensePage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "transactions", element: <MerchantTransactionsPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export function App() {
  return (
    <HelmetProvider>
      <AtpSessionProvider>
        <Toaster richColors position="top-center" />
        <RouterProvider router={router} />
      </AtpSessionProvider>
    </HelmetProvider>
  );
}
