import {
  Navigate,
  RouterProvider,
  createBrowserRouter,
} from "react-router-dom";
import { Toaster } from "sonner";
import { AtpSessionProvider } from "@/hooks/useAtpSession";
import { PublicLayout } from "@/routes/PublicLayout";
import { HomePage } from "@/routes/HomePage";
import { ItemDetailPage } from "@/routes/ItemDetailPage";
import { PurchaseDetailPage } from "@/routes/PurchaseDetailPage";
import { PurchaseSuccessPage } from "@/routes/PurchaseSuccessPage";
import { MerchantLayout } from "@/routes/MerchantLayout";
import { DashboardPage } from "@/routes/DashboardPage";
import { CustomerDashboardPage } from "./routes/CustomerDashboardPage";
import { MerchantInventoryPage } from "@/routes/MerchantInventoryPage";
import { MerchantInventoryEditPage } from "@/routes/MerchantInventoryEditPage";
import { UploadTracksPage } from "@/routes/UploadTracksPage";
import { UploadPhysicalPage } from "@/routes/UploadPhysicalPage";
import { ListingsPage } from "@/routes/ListingsPage";
import { LicensePage } from "@/routes/LicensePage";
import { SettingsPage } from "@/routes/SettingsPage";
import { MerchantTransactionsPage } from "@/routes/MerchantTransactionsPage";
import { MerchantSignInPage } from "@/routes/MerchantSignInPage";
import { TermsPage } from "@/routes/TermsPage";
import { RefundsPage } from "@/routes/RefundsPage";

const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/terms", element: <TermsPage /> },
      { path: "/refunds", element: <RefundsPage /> },
      { path: "/item/:uri", element: <ItemDetailPage /> },
      { path: "/purchase/success", element: <PurchaseSuccessPage /> },
      { path: "/merchant/signin", element: <MerchantSignInPage /> },
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
      {
        path: "inventory/edit",
        element: <MerchantInventoryEditPage />,
      },
      { path: "upload/tracks", element: <UploadTracksPage /> },
      { path: "upload/physical", element: <UploadPhysicalPage /> },
      { path: "listings", element: <ListingsPage /> },
      { path: "license", element: <LicensePage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "transactions", element: <MerchantTransactionsPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

export function App() {
  return (
    <AtpSessionProvider>
      <Toaster richColors position="top-center" />
      <RouterProvider router={router} />
    </AtpSessionProvider>
  );
}
