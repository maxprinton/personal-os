"use client";

import { useActionState } from "react";
import { connectBot, refreshBotMenu } from "@/app/settings-actions";
import type { ActionState } from "@/app/actions";

export default function ConnectBotButton({ connected }: { connected: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(connectBot, {});
  const [menuState, menuAction, menuPending] = useActionState<ActionState, FormData>(refreshBotMenu, {});
  return (
    <div className="space-y-2">
    <form action={action} className="space-y-1">
      <button disabled={pending} className="rounded-md border border-edge transition-colors hover:bg-subtle px-3 py-1.5 text-sm disabled:opacity-50">
        {pending ? "Connecting..." : connected ? "Reconnect bot" : "Connect bot to this app"}
      </button>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.ok && <p className="text-sm text-success">Bot connected.</p>}
    </form>
    {connected && (
      <form action={menuAction} className="space-y-1">
        <button disabled={menuPending} className="rounded-md border border-edge transition-colors hover:bg-subtle px-3 py-1.5 text-sm disabled:opacity-50">
          {menuPending ? "Updating..." : "Update Telegram menu"}
        </button>
        <p className="text-xs text-muted">Sends the current list of commands to the “/” menu in Telegram. Use it after the bot learns something new.</p>
        {menuState.error && <p className="text-sm text-danger">{menuState.error}</p>}
        {menuState.ok && <p className="text-sm text-success">Menu updated.</p>}
      </form>
    )}
    </div>
  );
}
