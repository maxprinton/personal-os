// YouTube Pipeline add-on: header + sub-navigation for every /youtube page (Lead).
// If migration 0031 has not been run, every page shows the "run the migration" panel instead.
import { getYtSettings } from "@/lib/youtube/db";
import { AddonNav, HideOnFullscreen } from "@/components/youtube/shell/YtNav";
import MigrationPanel from "@/components/youtube/shell/MigrationPanel";

export const metadata = { title: "YouTube · Personal OS" };
export const dynamic = "force-dynamic";

export default async function YoutubeLayout({ children }: { children: React.ReactNode }) {
  const { settings, missing } = await getYtSettings();
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
      <HideOnFullscreen>
        <header className="mb-4 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">YouTube</h1>
              <p className="text-sm text-muted">
                {settings?.channel_title || settings?.channel_handle || "From idea to 90-day follow-up, one video at a time."}
              </p>
            </div>
          </div>
          <AddonNav />
        </header>
      </HideOnFullscreen>
      {missing ? <MigrationPanel /> : children}
    </div>
  );
}
