// /youtube/settings (Lead). The Google / API panel is Worker C's component.
import Section from "@/components/ui/Section";
import GoogleConnectPanel from "@/components/youtube/publish/GoogleConnectPanel";
import SettingsForm from "@/app/youtube/settings/SettingsForm";
import { getOauthStatus, getYtSettings } from "@/lib/youtube/db";

export const metadata = { title: "YouTube settings · Personal OS" };

export default async function YoutubeSettingsPage() {
  const [{ settings }, status] = await Promise.all([getYtSettings(), getOauthStatus()]);
  if (!settings) return null;
  const apiKeySet = !!process.env.YOUTUBE_API_KEY;
  const oauthConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.YT_TOKEN_KEY);
  return (
    <div className="max-w-3xl space-y-8">
      <Section title="Google and YouTube API">
        <GoogleConnectPanel status={status} apiKeySet={apiKeySet} oauthConfigured={oauthConfigured} channelUrl={settings.channel_url} />
      </Section>
      <Section title="Settings">
        <SettingsForm s={settings} />
      </Section>
    </div>
  );
}
