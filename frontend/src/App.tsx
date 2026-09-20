import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import UploadPage from "./pages/UploadPage";
import DashboardPage from "./pages/DashboardPage";

export default function App() {
  return (
    <HashRouter>
      <nav className="topnav">
        <NavLink to="/">Dashboard</NavLink>
        <NavLink to="/upload">Upload</NavLink>
      </nav>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/upload" element={<UploadPage />} />
      </Routes>
    </HashRouter>
  );
}