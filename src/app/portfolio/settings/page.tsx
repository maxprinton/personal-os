// /portfolio/settings — identity, languages, features and never-public words.
import SiteForm from "@/components/portfolio/SiteForm";
import { portfolioServer } from "@/lib/portfolio/db";
import { loadSite } from "@/lib/portfolio/site";

export const metadata = { title: "Portfolio settings · Personal OS" };

export default async function PortfolioSettings() {
  const { supabase, userId } = await portfolioServer();
  if (!userId) return null;
  const { site } = await loadSite(supabase, userId);
  return (
    <div className="max-w-3xl">
      <SiteForm site={site} />
    </div>
  );
}
