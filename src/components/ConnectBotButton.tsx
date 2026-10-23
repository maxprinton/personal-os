"use client";

import { useActionState } from "react";
import { connectBot } from "@/app/settings-actions";
import type { ActionState } from "@/app/actions";

export default function ConnectBotButton({ connected }: { connected: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(connectBot, {});
  return (
    <form action={action} className="space-y-1">
      <button disabled={pending} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm disabled:opacity-50">
        {pending ? "Connecting..." : connected ? "Reconnect bot" : "Connect bot to this app"}
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-700">Bot connected.</p>}
    </form>
  );
}
