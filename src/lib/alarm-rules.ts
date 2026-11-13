// Alarm rules of a block (pure logic, safe in the browser and on the server).
// A block name can have several "rings". Each ring is anchored to the start or the end of the block,
// moved by some minutes, and can repeat on its own (an escalating chain) until you tap "I'm up".
// Without rules, the old setting (block_types.alarm_minutes_before) still works as one ring.

export type RingAnchor = "start" | "end";
/** alarm = full screen, loud, until you answer. notify = a banner with a sound, no takeover. */
export type RingStyle = "alarm" | "notify";

export type AlarmRing = {
  anchor: RingAnchor;
  /** Minutes from the anchor: negative = before, positive = after. -180..180. */
  offset: number;
  /** "default" (the sound chosen in the phone app) or one of SOUNDS. */
  sound: string;
  /** Sound of the repeat rings. null = the same as the first ring. */
  repeatSound: string | null;
  style: RingStyle;
  /** Extra rings after the first one (0 = rings once). 0..5. */
  repeats: number;
  /** Minutes between rings of the chain. 1..30. */
  every: number;
  /** Each repeat starts louder than the one before. */
  louder: boolean;
};

export const SOUNDS: { id: string; name: string }[] = [
  { id: "default", name: "Phone app default" },
  { id: "rooster", name: "Rooster" },
  { id: "chime", name: "Soft chime" },
  { id: "bell", name: "Bell" },
  { id: "sunrise", name: "Sunrise" },
  { id: "calm", name: "Calm rise" },
  { id: "bells", name: "Soft bells" },
  { id: "marimba", name: "Marimba" },
  { id: "dingdong", name: "Ding dong" },
  { id: "radar", name: "Radar" },
  { id: "digital", name: "Digital beeps" },
  { id: "alert", name: "Alert siren" },
];

export const MAX_RINGS = 8;
export const MAX_OFFSET = 180;
export const MAX_REPEATS = 5;
export const MAX_EVERY = 30;

export type RingPreset = { id: string; name: string; hint: string; rings: AlarmRing[] };

const ring = (r: Partial<AlarmRing> & Pick<AlarmRing, "anchor" | "offset">): AlarmRing => ({
  sound: "default",
  repeatSound: null,
  style: "alarm",
  repeats: 0,
  every: 5,
  louder: false,
  ...r,
});

/** The presets people start from. Choosing one adds its rings; every value can be edited afterwards. */
export const PRESETS: RingPreset[] = [
  {
    id: "wake",
    name: "Wake-up",
    hint: "Rooster at the start, then again every 5 min, louder each time, until you tap “I’m up”",
    rings: [ring({ anchor: "start", offset: 0, sound: "rooster", repeats: 3, every: 5, louder: true })],
  },
  {
    id: "start",
    name: "Start now",
    hint: "A quiet heads-up 5 min before, then a bell at the start",
    rings: [
      ring({ anchor: "start", offset: -5, sound: "chime", style: "notify" }),
      ring({ anchor: "start", offset: 0, sound: "bell" }),
    ],
  },
  {
    id: "wrap",
    name: "Wrap-up heads-up",
    hint: "A soft chime 5 min before the block ends (a banner, no takeover)",
    rings: [ring({ anchor: "end", offset: -5, sound: "chime", style: "notify" })],
  },
  {
    id: "stop",
    name: "Hard stop",
    hint: "A bell when the block ends, again every 3 min (twice), until you tap “Got it”",
    rings: [ring({ anchor: "end", offset: 0, sound: "bell", repeats: 2, every: 3, louder: true })],
  },
];

const soundIds = new Set(SOUNDS.map((s) => s.id));

function int(v: unknown, min: number, max: number, fallback: number) {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function cleanSound(v: unknown, fallback: string | null): string | null {
  return typeof v === "string" && soundIds.has(v) ? v : fallback;
}

/** One ring from anything: unknown fields are dropped and every number is clamped. */
export function cleanRing(raw: unknown): AlarmRing | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.anchor !== "start" && r.anchor !== "end") return null;
  const repeats = int(r.repeats, 0, MAX_REPEATS, 0);
  return {
    anchor: r.anchor,
    offset: int(r.offset, -MAX_OFFSET, MAX_OFFSET, 0),
    sound: cleanSound(r.sound, "default") as string,
    repeatSound: repeats > 0 ? cleanSound(r.repeatSound, null) : null,
    style: r.style === "notify" ? "notify" : "alarm",
    repeats,
    every: int(r.every, 1, MAX_EVERY, 5),
    louder: repeats > 0 && r.louder === true,
  };
}

/** A list of rings from the database or a form. Returns [] for nothing usable, never throws. */
export function cleanRules(raw: unknown): AlarmRing[] {
  if (!Array.isArray(raw)) return [];
  const out: AlarmRing[] = [];
  for (const item of raw) {
    const r = cleanRing(item);
    if (r) out.push(r);
    if (out.length >= MAX_RINGS) break;
  }
  return out;
}

/** The rings that apply to a block: its own rules, else the old "minutes before" as one ring, else none. */
export function effectiveRules(t: { alarm_rules?: unknown; alarm_minutes_before?: number | null }): AlarmRing[] {
  if (Array.isArray(t.alarm_rules)) return cleanRules(t.alarm_rules);
  if (t.alarm_minutes_before != null) {
    return [ring({ anchor: "start", offset: -Math.abs(t.alarm_minutes_before) })];
  }
  return [];
}

/** True when the block has at least one ring. */
export function hasAlarm(t: { alarm_rules?: unknown; alarm_minutes_before?: number | null }) {
  return effectiveRules(t).length > 0;
}

/** Escalation level of ring number k (0 = the first one): 0 normal, 1 louder, 2+ full volume. */
export function levelOf(r: Pick<AlarmRing, "louder">, k: number) {
  return r.louder ? k : 0;
}

/** Sound of ring number k of a chain. */
export function soundOf(r: Pick<AlarmRing, "sound" | "repeatSound">, k: number) {
  return k > 0 && r.repeatSound ? r.repeatSound : r.sound;
}

function soundName(id: string) {
  return SOUNDS.find((s) => s.id === id)?.name.toLowerCase() ?? id;
}

/** "At the start", "5 min before the end", "10 min after the start". */
export function whenText(r: Pick<AlarmRing, "anchor" | "offset">) {
  const a = r.anchor === "start" ? "start" : "end";
  if (r.offset === 0) return r.anchor === "start" ? "At the start" : "At the end";
  return `${Math.abs(r.offset)} min ${r.offset < 0 ? "before" : "after"} the ${a}`;
}

/** One plain sentence about a ring, shown under it in the editor. */
export function describeRing(r: AlarmRing) {
  const parts = [`${whenText(r)}: ${soundName(r.sound)}`];
  parts.push(r.style === "alarm" ? "full screen" : "banner only");
  if (r.repeats > 0) {
    const rep = r.repeatSound && r.repeatSound !== r.sound ? `, then ${soundName(r.repeatSound)}` : "";
    parts.push(
      `${r.repeats} more time${r.repeats === 1 ? "" : "s"} every ${r.every} min${rep}${r.louder ? ", louder each time" : ""} until you tap the button`
    );
  }
  return parts.join(" · ");
}

/** Clock times of every ring for a block that runs start..end (HH:MM, minutes since midnight, may pass 24h). */
export function ringMinutes(r: AlarmRing, startMin: number, endMin: number) {
  const base = (r.anchor === "start" ? startMin : endMin) + r.offset;
  const out: number[] = [];
  for (let k = 0; k <= r.repeats; k++) out.push(base + k * r.every);
  return out;
}
