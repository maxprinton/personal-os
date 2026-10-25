"use client";

import Icon from "@/components/ui/Icon";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-app p-4">
      <div className="card w-full max-w-sm space-y-6 p-6 sm:p-8">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-fg">
            <Icon name="logo" size={16} />
          </span>
          Personal OS
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Set a new password</h1>
        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="New password (min. 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-line-strong px-3 py-2"
          />
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="Repeat new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-md border border-line-strong px-3 py-2"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-2 text-accent-fg disabled:opacity-50"
          >
            {busy ? "Saving..." : "Save password"}
          </button>
          {error && <p className="text-sm text-danger">{error}</p>}
        </form>
      </div>
    </main>
  );
}
