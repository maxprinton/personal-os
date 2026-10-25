"use client";

import Icon from "@/components/ui/Icon";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  async function onForgot() {
    setError("");
    setInfo("");
    if (!email) {
      setError("Type your email first, then click Forgot password.");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setBusy(false);
    if (error) setError(error.message);
    else setInfo("Check your email for a link to set a new password.");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfo("");
    const supabase = createClient();

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
      router.replace("/");
      router.refresh();
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) {
      setError(error.message);
    } else if (data.session) {
      router.replace("/");
      router.refresh();
    } else {
      setInfo("Account created. Confirm your email once, then sign in with your password.");
      setMode("signin");
    }
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
        <h1 className="text-xl font-semibold tracking-tight">
          {mode === "signin" ? "Sign in to Personal OS" : "Create your account"}
        </h1>
        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-line-strong px-3 py-2"
          />
          <input
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            placeholder="Password (min. 8 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-line-strong px-3 py-2"
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-accent font-medium shadow-sm transition-colors hover:bg-accent-hover px-3 py-2 text-accent-fg disabled:opacity-50"
          >
            {busy ? "Please wait..." : mode === "signin" ? "Sign in" : "Create account"}
          </button>
          {error && <p className="text-sm text-danger">{error}</p>}
          {info && <p className="text-sm text-success">{info}</p>}
        </form>
        {mode === "signin" && (
          <button
            type="button"
            onClick={onForgot}
            disabled={busy}
            className="block text-sm font-medium text-accent hover:underline"
          >
            Forgot password?
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError("");
          }}
          className="text-sm text-muted hover:text-fg"
        >
          {mode === "signin" ? "No account yet? Create one" : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
