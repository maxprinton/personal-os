import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fillWorkbook, type FillRow } from "@/lib/xlsx-fill";
import { templateBytes } from "@/lib/xlsx-template";
import {
  byTime, fmtHours, isMonthKey, isValidForReport, monthBounds, monthLabelEs, sheetRange, SHEET_TYPE_LABEL, summarize, toWorkClass, type SheetType,
} from "@/lib/work-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?month=YYYY-MM&lost=0 → the month's Excel in the company's format (“Resumen” + “Reporte detallado”), ready to upload. */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });

  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? "";
  const lostRaw = Number((url.searchParams.get("lost") ?? "0").replace(",", "."));
  if (!isMonthKey(month)) return NextResponse.json({ error: "Unknown month." }, { status: 400 });
  const lost = Number.isFinite(lostRaw) && lostRaw >= 0 ? lostRaw : 0;

  const { from, to } = monthBounds(month);
  const [classesRes, settingsRes] = await Promise.all([
    supabase.from("work_classes").select("*").gte("class_date", from).lte("class_date", to),
    supabase.from("work_settings").select("teacher_name").maybeSingle(),
  ]);
  if (classesRes.error) return NextResponse.json({ error: classesRes.error.message }, { status: 500 });
  const classes = ((classesRes.data ?? []) as Record<string, unknown>[]).map(toWorkClass).sort(byTime);
  const sum = summarize(classes);

  const rows: FillRow[] = classes.filter(isValidForReport).map((c) => ({
    date: c.class_date,
    time: sheetRange(c.start_time, c.end_time),
    group: c.group_name,
    type: SHEET_TYPE_LABEL[c.sheet_type as SheetType],
    requested: c.requested_by ?? "",
    evidence: c.video_url ?? "",
    info: c.notes ?? "",
  }));

  try {
    const { bytes } = fillWorkbook(templateBytes(), rows, {
      teacher: settingsRes.data?.teacher_name ?? "",
      month: monthLabelEs(month),
      lost,
      recovered: Number(fmtHours(sum.recoveryHours)),
      extra: Number(fmtHours(sum.extraHours)),
      collaborations: sum.collaborationCount,
    });
    return new Response(Buffer.from(bytes), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="Reporte-de-horas-${month}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "I couldn't build the Excel." }, { status: 500 });
  }
}
