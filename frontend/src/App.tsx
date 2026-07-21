import { Route, Routes } from "react-router-dom";
import HomeFlow from "./pages/HomeFlow";
import DebugPage from "./pages/DebugPage";
import { LanguageProvider } from "./lib/i18n";
import "./styles/journal.css";

export default function App() {
  return (
    <LanguageProvider>
      <Routes>
        <Route path="/" element={<HomeFlow />} />
        <Route path="/debug" element={<DebugPage />} />
      </Routes>
    </LanguageProvider>
  );
}
