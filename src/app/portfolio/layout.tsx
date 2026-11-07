// Portfolio add-on: header + sub-navigation for every /portfolio page.
// If migration 0042 has not been run, every page shows the "run the migration" panel instead.
import { portfolioReady } from "@/lib/portfolio/db";
import PortfolioNav from "@/components/portfolio/PortfolioNav";
import MigrationPanel from "@/components/portfolio/MigrationPanel";

export const metadata = { title: "Portfolio · Personal OS" };
export const dynamic = "force-dynamic";

export default async function PortfolioLayout({ children }: { children: React.ReactNode }) {
  const { missing } = await portfolioReady();
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
      <header className="mb-4 space-y-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
          <p className="text-sm text-muted">Your public website. Write pages as notes, publish them when they are ready.</p>
        </div>
        <PortfolioNav />
      </header>
      {missing ? <MigrationPanel /> : children}
    </div>
  );
}
