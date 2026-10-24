// Calendar v1 actions were moved to app/calendar-actions.ts (blocks, events, event types).
// The old time_blocks table is kept read-only as a backup; nothing writes to it anymore.

export type ActionState = { error?: string; ok?: boolean; at?: number };
