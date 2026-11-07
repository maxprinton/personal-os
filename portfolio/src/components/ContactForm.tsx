"use client";
// The contact form: name (optional), email, message, a hidden honeypot and the Turnstile check. Sends to /api/contact.
import { useEffect, useRef, useState } from "react";
import { DICT, type Lang } from "../lib/i18n";

type Turnstile = { render: (el: HTMLElement, o: { sitekey: string; callback: (t: string) => void; "expired-callback": () => void; "error-callback": () => void }) => string; reset: (id?: string) => void };
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

export default function ContactForm({ lang, siteKey }: { lang: Lang; siteKey: string }) {
  const t = DICT[lang].contact;
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState("");
  const token = useRef("");
  const widget = useRef<string | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const started = useRef(0);

  useEffect(() => {
    started.current = Date.now();
    const mount = () => {
      if (!window.turnstile || !box.current || widget.current) return;
      widget.current = window.turnstile.render(box.current, { sitekey: siteKey, callback: (x) => (token.current = x), "expired-callback": () => (token.current = ""), "error-callback": () => (token.current = "") });
    };
    if (window.turnstile) mount();
    else {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = mount;
      document.head.appendChild(s);
    }
  }, [siteKey]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === "sending") return;
    const f = new FormData(e.currentTarget);
    setErrors({});
    setBanner("");
    if (!token.current) return setBanner(t.verify);
    setState("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: f.get("name"), email: f.get("email"), message: f.get("message"), website: f.get("website"), lang, token: token.current, elapsed: Date.now() - started.current }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; fields?: Record<string, string> };
      if (res.ok && j.ok) return setState("sent");
      setState("idle");
      if (j.fields) setErrors(j.fields);
      setBanner(j.error === "too_many" ? t.tooMany : j.error === "verify" ? t.verify : j.error === "invalid" ? "" : t.failed);
      token.current = "";
      window.turnstile?.reset(widget.current);
    } catch {
      setState("idle");
      setBanner(t.failed);
    }
  }

  if (state === "sent")
    return (
      <div role="status" className="cform-done">
        <h2>{t.sent}</h2>
        <p>{t.sentText}</p>
        <button type="button" className="btn" onClick={() => { setState("idle"); token.current = ""; window.turnstile?.reset(widget.current); started.current = Date.now(); }}>
          {t.another}
        </button>
      </div>
    );

  const err = (k: string) => (errors[k] ? <span className="ferr" id={`e-${k}`} role="alert">{t.errors[errors[k] as keyof typeof t.errors] ?? t.errors.invalid}</span> : null);
  return (
    <form className="cform" onSubmit={submit} noValidate>
      <label>
        <span>
          {t.name} <small>({t.nameHint})</small>
        </span>
        <input name="name" type="text" autoComplete="name" maxLength={80} aria-invalid={!!errors.name} aria-describedby={errors.name ? "e-name" : undefined} />
        {err("name")}
      </label>
      <label>
        <span>{t.email}</span>
        <input name="email" type="email" autoComplete="email" required maxLength={254} aria-invalid={!!errors.email} aria-describedby={errors.email ? "e-email" : undefined} />
        {err("email")}
      </label>
      <label>
        <span>{t.message}</span>
        <textarea name="message" rows={7} required maxLength={4000} aria-invalid={!!errors.message} aria-describedby={errors.message ? "e-message" : undefined} />
        {err("message")}
      </label>
      {/* honeypot: hidden from people and from screen readers; bots fill it */}
      <div className="hp" aria-hidden="true">
        <label>
          Website
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div ref={box} className="tsbox" />
      {banner && (
        <p className="ferr" role="alert">
          {banner}
        </p>
      )}
      <button className="btn" type="submit" disabled={state === "sending"}>
        {state === "sending" ? t.sending : t.send}
      </button>
      <p className="fhint">{t.privacy}</p>
    </form>
  );
}
