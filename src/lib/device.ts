// Phone detection (server only). On a phone the calendar is read-only: all editing happens on
// the computer. Telegram stays the way to mark habits and complete tasks on the go.
import { headers } from "next/headers";

const MOBILE_RE = /Android|iPhone|iPad|iPod|Mobile|Windows Phone|webOS|BlackBerry/i;

export function isMobileUA(ua: string | null | undefined) {
  return Boolean(ua && MOBILE_RE.test(ua));
}

/** True when the current request comes from a phone/tablet browser. */
export async function isMobileRequest() {
  const h = await headers();
  if (h.get("sec-ch-ua-mobile") === "?1") return true;
  return isMobileUA(h.get("user-agent"));
}

export const READ_ONLY_MESSAGE = "On the phone the calendar is read-only. Make changes on the computer (or use Telegram for habits and tasks).";
