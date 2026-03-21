import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { EnrollPage } from "./pages/EnrollPage";
import { AuthPage } from "./pages/AuthPage";
import { LandingPage } from "./pages/LandingPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/enroll" element={<EnrollPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}