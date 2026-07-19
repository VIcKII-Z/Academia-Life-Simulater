import { Route, Routes } from "react-router-dom";
import HomeFlow from "./pages/HomeFlow";
import DebugPage from "./pages/DebugPage";
import "./styles/journal.css";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeFlow />} />
      <Route path="/debug" element={<DebugPage />} />
    </Routes>
  );
}
