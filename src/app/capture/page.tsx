import { redirect } from "next/navigation";

// Capture became the Telegram module (catalog + practice chat + your command words).
// The quick-add box and its offline queue (QuickCapture, /api/capture) are still in the code, unused by this page.
export default function CapturePage() {
  redirect("/telegram");
}
