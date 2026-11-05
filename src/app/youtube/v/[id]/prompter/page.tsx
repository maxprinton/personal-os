// /youtube/v/[id]/prompter — Teleprompter (full screen) (Worker B).
// ?section=<id> shows one part; ?setup=<setup name> shows only the lines of that filming setup.
import { notFound } from "next/navigation";
import { loadShotData } from "@/components/youtube/shots/load";
import Teleprompter from "@/components/youtube/shots/Teleprompter";

export const dynamic = "force-dynamic";

export default async function PrompterPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ section?: string; setup?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { data, missing } = await loadShotData(id);
  if (missing) return null;
  if (!data) notFound();
  const v = data.video;
  const codeOf = new Map(data.sections.map((s) => [s.id, s.code]));
  return (
    <Teleprompter
      videoId={v.id}
      title={`${v.code ?? "VXXX"} · ${v.idea_name}`}
      sections={data.rawSections.map((s) => ({ id: s.id, code: codeOf.get(s.id) ?? "S??", title: s.title, content: s.content ?? "" }))}
      shots={data.shots.map((s) => ({ kind: s.kind, setup: s.setup, location: s.location, para_hash: s.para_hash, done: s.done }))}
      defaultWpm={data.wpm}
      initialSection={typeof sp.section === "string" ? sp.section : null}
      initialSetup={typeof sp.setup === "string" ? sp.setup : null}
    />
  );
}
