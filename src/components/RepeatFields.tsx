"use client";

import { useState } from "react";
import { inputCls } from "@/components/calendar/Modal";

const UNITS = [
  ["days", "days"],
  ["weeks", "weeks"],
  ["months", "months"],
  ["years", "years"],
] as const;

/**
 * "Repeat: Never / After I finish it, every [N] [days]". Fields: repeat_mode (none | after), repeat_every,
 * repeat_unit. The next task appears that many days AFTER the day this one is marked done.
 */
export default function RepeatFields({
  defaultRepeating = false,
  defaultEvery = 3,
  defaultUnit = "days",
  disabled = false,
  onChange,
}: {
  defaultRepeating?: boolean;
  defaultEvery?: number;
  defaultUnit?: string;
  disabled?: boolean;
  onChange?: (repeating: boolean) => void;
}) {
  const [repeating, setRepeating] = useState(defaultRepeating);
  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-40 flex-1">
          Repeat
          <select
            name="repeat_mode"
            value={repeating ? "after" : "none"}
            disabled={disabled}
            onChange={(e) => {
              const on = e.target.value === "after";
              setRepeating(on);
              onChange?.(on);
            }}
            className={`mt-1 ${inputCls} disabled:opacity-50`}
          >
            <option value="none">Never</option>
            <option value="after">After I finish it</option>
          </select>
        </label>
        {repeating && (
          <>
            <label className="w-24">
              Every
              <input type="number" name="repeat_every" min={1} max={366} defaultValue={defaultEvery} className={`mt-1 ${inputCls}`} />
            </label>
            <label className="w-32">
              <span className="sr-only">Unit</span>
              <select name="repeat_unit" defaultValue={defaultUnit} className={inputCls}>
                {UNITS.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      {repeating && (
        <p className="text-xs text-muted">
          When you mark it done, the next one appears that many days later (counted from the day you finished, not from the day it was due).
        </p>
      )}
    </div>
  );
}
