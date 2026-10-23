import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: settings } = await supabase
    .from("user_settings")
    .select("timezone, currency, locale")
    .maybeSingle();

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="space-y-4 text-center">
        <h1 className="text-3xl font-semibold">Hello, Personal OS</h1>
        <p className="text-neutral-500">Signed in as {user?.email}</p>
        {settings && (
          <p className="text-sm text-neutral-500">
            {settings.timezone} · {settings.currency} · {settings.locale}
          </p>
        )}
        <form action="/auth/signout" method="post">
          <button className="rounded-md border border-neutral-300 px-3 py-1 text-sm">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
