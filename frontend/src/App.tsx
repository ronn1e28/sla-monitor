import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import UploadPage from "./pages/UploadPage";
import DashboardPage from "./pages/DashboardPage";

export default function App() {
  return (
    <HashRouter>
      <nav className="topnav">
        <div className="topnav-inner">
          <span className="topnav-brand">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            SLA Monitor
          </span>
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/upload">Upload</NavLink>
        </div>
      </nav>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/upload" element={<UploadPage />} />
      </Routes>
    </HashRouter>
  );
}
