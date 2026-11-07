// Portfolio contact form — checks and cleans what a visitor typed. Pure (no imports).
// This file is copied byte-for-byte to portfolio/src/lib/contact-validate.ts (test:site checks they are identical):
// the public site checks first, the OS checks again before saving anything.

export const CONTACT_LIMITS = { name: 80, email: 254, message: 4000, minMessage: 10 } as const;
export type ContactInput = { name: string; email: string; message: string; lang: "en" | "es" };
export type ContactField = "name" | "email" | "message";
export type ContactProblem = "required" | "invalid" | "short" | "long";
export type ContactCheck = { ok: true; value: ContactInput } | { ok: false; errors: Partial<Record<ContactField, ContactProblem>> };

// letters, digits and the usual symbols; no spaces, quotes, brackets, commas or control characters
const EMAIL = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\]{2,}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029]/g;

const text = (v: unknown) => (typeof v === "string" ? v : "");

export function validateContact(raw: unknown): ContactCheck {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const errors: Partial<Record<ContactField, ContactProblem>> = {};

  const name = text(o.name).replace(CONTROL, "").replace(/\s+/g, " ").trim();
  if (name.length > CONTACT_LIMITS.name) errors.name = "long";

  const email = text(o.email).trim();
  if (!email) errors.email = "required";
  else if (email.length > CONTACT_LIMITS.email || !EMAIL.test(email) || email.includes("..") || email.startsWith(".") || email.split("@")[0].endsWith(".")) errors.email = "invalid";

  const message = text(o.message)
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  if (!message) errors.message = "required";
  else if (message.length < CONTACT_LIMITS.minMessage) errors.message = "short";
  else if (message.length > CONTACT_LIMITS.message) errors.message = "long";

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, email, message, lang: o.lang === "es" ? "es" : "en" } };
}
