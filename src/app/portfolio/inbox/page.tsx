// /portfolio/inbox — messages from the contact form. Spam is kept in its own tab.
import Link from "next/link";
import InboxList from "@/components/portfolio/InboxList";
import { BASE } from "@/lib/portfolio/constants";
import { portfolioServer } from "@/lib/portfolio/db";
import { listInbox, unreadCount } from "@/lib/portfolio/inbox";

export const metadata = { title: "Portfolio inbox · Personal OS" };

export default async function PortfolioInbox({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const spamTab = tab === "spam";
  const { supabase, userId } = await portfolioServer();
  if (!userId) return null;
  const [rows, unread] = await Promise.all([listInbox(supabase, userId, spamTab), unreadCount(supabase, userId)]);
  const chip = (on: boolean) => `rounded-full px-2.5 py-1 text-xs ${on ? "bg-accent-soft font-medium text-accent" : "bg-subtle text-muted hover:text-fg"}`;
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex gap-1.5">
        <Link href={`${BASE}/inbox`} className={chip(!spamTab)}>
          Inbox{unread ? ` (${unread})` : ""}
        </Link>
        <Link href={`${BASE}/inbox?tab=spam`} className={chip(spamTab)}>
          Spam
        </Link>
      </div>
      <InboxList rows={rows} spamTab={spamTab} />
    </div>
  );
}
