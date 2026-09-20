import StatsSection from "../components/StatsSection";
import LogsSection from "../components/LogsSection";

export default function DashboardPage() {
  return (
    <main className="page">
      <StatsSection />
      <LogsSection />
    </main>
  );
}