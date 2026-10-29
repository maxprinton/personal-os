"use client";

// Notion's code block: language picker (top left), Wrap / Copy (top right), syntax colors,
// and Mermaid diagrams with Code · Preview · Split.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { Popover, MenuItem, useListKeys } from "@/components/editor/ui";

export const LANGUAGES: { id: string | null; label: string }[] = [
  { id: null, label: "Plain text" },
  { id: "bash", label: "Bash" },
  { id: "c", label: "C" },
  { id: "csharp", label: "C#" },
  { id: "cpp", label: "C++" },
  { id: "css", label: "CSS" },
  { id: "diff", label: "Diff" },
  { id: "go", label: "Go" },
  { id: "graphql", label: "GraphQL" },
  { id: "xml", label: "HTML" },
  { id: "ini", label: "INI / TOML" },
  { id: "java", label: "Java" },
  { id: "javascript", label: "JavaScript" },
  { id: "json", label: "JSON" },
  { id: "kotlin", label: "Kotlin" },
  { id: "less", label: "Less" },
  { id: "lua", label: "Lua" },
  { id: "makefile", label: "Makefile" },
  { id: "markdown", label: "Markdown" },
  { id: "mermaid", label: "Mermaid" },
  { id: "objectivec", label: "Objective-C" },
  { id: "perl", label: "Perl" },
  { id: "php", label: "PHP" },
  { id: "python", label: "Python" },
  { id: "r", label: "R" },
  { id: "ruby", label: "Ruby" },
  { id: "rust", label: "Rust" },
  { id: "scss", label: "SCSS" },
  { id: "shell", label: "Shell" },
  { id: "sql", label: "SQL" },
  { id: "swift", label: "Swift" },
  { id: "typescript", label: "TypeScript" },
  { id: "vbnet", label: "VB.Net" },
  { id: "yaml", label: "YAML" },
];

const ALIASES: Record<string, string> = { js: "javascript", ts: "typescript", py: "python", sh: "bash", html: "xml", yml: "yaml", "c++": "cpp", "c#": "csharp", md: "markdown", toml: "ini" };
export const normLang = (l: string | null | undefined) => (l ? ALIASES[l.toLowerCase()] ?? l.toLowerCase() : null);
const labelOf = (l: string | null) => LANGUAGES.find((x) => x.id === normLang(l))?.label ?? (l || "Plain text");

let mermaidP: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  return (mermaidP ??= import("mermaid").then((m) => {
    const dark = document.documentElement.dataset.theme === "dark";
    m.default.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
    return m.default;
  }));
}

function MermaidPreview({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      if (!code.trim()) return setSvg("");
      void loadMermaid()
        .then((m) => m.render(`mmd${id}${Date.now()}`, code))
        .then((r) => {
          if (alive) {
            setSvg(r.svg);
            setErr(null);
          }
        })
        .catch((e: unknown) => alive && setErr(e instanceof Error ? e.message.split("\n")[0] : "Can't draw this diagram."));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [code, id]);
  if (err) return <p className="n-mermaid-error">{err}</p>;
  return <div className="n-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export default function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const lang = normLang(node.attrs.language as string | null);
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<"code" | "preview" | "split">("split");
  const isMermaid = lang === "mermaid";
  const text = node.textContent;

  return (
    <NodeViewWrapper className={`n-code ${wrap ? "is-wrap" : ""} ${isMermaid ? `is-mermaid view-${view}` : ""}`}>
      <div className="n-code-bar" contentEditable={false}>
        <button type="button" className="n-code-lang" disabled={!editor.isEditable} onClick={(e) => setPicker((e.currentTarget as HTMLElement).getBoundingClientRect())}>
          {labelOf(lang)} <span className="opacity-60">▾</span>
        </button>
        <span className="flex-1" />
        {isMermaid &&
          (["code", "preview", "split"] as const).map((v) => (
            <button key={v} type="button" className={`n-code-btn ${view === v ? "is-on" : ""}`} onClick={() => setView(v)}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        <button type="button" className={`n-code-btn ${wrap ? "is-on" : ""}`} onClick={() => setWrap((w) => !w)}>
          Wrap
        </button>
        <button
          type="button"
          className="n-code-btn"
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
      <pre className="n-code-pre">
        <NodeViewContent<"code"> as="code" className={lang ? `hljs language-${lang}` : "hljs"} />
      </pre>
      {isMermaid && view !== "code" && <MermaidPreview code={text} />}
      {picker && (
        <LangPicker
          rect={picker}
          current={lang}
          onClose={() => setPicker(null)}
          onPick={(id) => {
            updateAttributes({ language: id });
            setPicker(null);
          }}
        />
      )}
    </NodeViewWrapper>
  );
}

function LangPicker({ rect, current, onPick, onClose }: { rect: DOMRect; current: string | null; onPick: (id: string | null) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => LANGUAGES.filter((l) => l.label.toLowerCase().includes(q.trim().toLowerCase())), [q]);
  const [index, setIndex] = useListKeys(list.length, (i) => list[i] && onPick(list[i].id));
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Popover rect={rect} onClose={onClose} width={220} className="n-menu">
      <div className="p-1">
        <input ref={ref} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for a language…" className="n-input mb-1 w-full" />
        <div className="max-h-[300px] overflow-y-auto">
          {list.map((l, i) => (
            <MenuItem key={l.label} label={l.label} active={i === index} onHover={() => setIndex(i)} right={l.id === current ? <span className="text-xs">✓</span> : undefined} onClick={() => onPick(l.id)} />
          ))}
        </div>
      </div>
    </Popover>
  );
}
