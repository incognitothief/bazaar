import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { PublicLayout } from "@/routes/PublicLayout";
import { HomePage } from "@/routes/HomePage";
import { ItemDetailPage } from "@/routes/ItemDetailPage";
import { PurchaseSuccessPage } from "@/routes/PurchaseSuccessPage";
import { MerchantLayout } from "@/routes/MerchantLayout";
import { DashboardPage } from "@/routes/DashboardPage";
import { CustomerDashboardPage } from "./routes/CustomerDashboardPage";
import { UploadDigitalPage } from "@/routes/UploadDigitalPage";
import { UploadPhysicalPage } from "@/routes/UploadPhysicalPage";
import { ListingsPage } from "@/routes/ListingsPage";
import { LicensePage } from "@/routes/LicensePage";
import { SettingsPage } from "@/routes/SettingsPage";
import { MerchantSignInPage } from "@/routes/MerchantSignInPage";

export function App() {
  return (
    <BrowserRouter>
      <Toaster richColors position="top-center" />
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/item/:uri" element={<ItemDetailPage />} />
          <Route path="/purchase/success" element={<PurchaseSuccessPage />} />
          <Route path="/merchant/signin" element={<MerchantSignInPage />} />
          <Route path="/dashboard" element={<CustomerDashboardPage />} />
        </Route>
        <Route path="/merchant" element={<MerchantLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="upload/digital" element={<UploadDigitalPage />} />
          <Route path="upload/physical" element={<UploadPhysicalPage />} />
          <Route path="listings" element={<ListingsPage />} />
          <Route path="license" element={<LicensePage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
