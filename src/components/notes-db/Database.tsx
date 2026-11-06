"use client";
// OWNED BY: database views. The notes database: toolbar (layout, search, filter chips, advanced filter,
// sort, properties, New ▾) and the Table / List / Gallery / Board views.
//
// The notes and properties live here (changes show at once, saves run inside the pieces). The view
// (layout, search, filters, sorts, columns, widths) is remembered in this browser only. The data is
// loaded again when the window gets the focus back, after a note is created ("notes-db-changed") and
// when the page's server data changes — never with a full page reload.
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { loadNotesDatabase, reorderProperties } from "@/app/notes-db-actions";
import { createNoteView, deleteNoteView, listNoteViews, reorderNoteViews, saveNoteView } from "@/app/note-view-actions";
import { NoteSelection, NotesExportBar } from "@/components/NotesExport";
import BulkEdit from "@/components/notes-db/BulkEdit";
import NewNoteButton from "@/components/notes-db/NewNoteButton";
import ViewTabs from "@/components/notes-db/ViewTabs";
import { BulkProvider } from "@/components/notes-db/db-bulk";
import { PropEnvContext, errorText, toast, type PropEnv } from "@/components/notes-db/prop-ui";
import { BoardView } from "@/components/notes-db/db-board";
import { GalleryView } from "@/components/notes-db/db-gallery";
import { ListView } from "@/components/notes-db/db-list";
import { DbEnvContext, NOTES_DB_CHANGED, displayTitle, exportOf, type DbEnv } from "@/components/notes-db/db-shared";
import { TableView } from "@/components/notes-db/db-table";
import { HIDE_BLOCKS_ID, Toolbar, type CardSize } from "@/components/notes-db/db-toolbar";
import { applyTagChangeToAll, TAGS_CHANGED, type TagChange } from "@/lib/notes-db/tag-ops";
import { applyView, canGroupBy, defaultGroupBy, defaultView, isFiltering, newRule, sanitizeView, valuesFromView } from "@/lib/notes-db/query";
import type { DbData, DbNote, Layout, NoteProperty, RelatedItem, TemplateInfo, ViewState } from "@/lib/notes-db/types";
import { LAYOUT_NAME, MAX_VIEWS, afterDelete, autoPartChanged, autoSavedState, copyName, draftPart, isDirty, nextViewName, reorderedViews, resetDraft, type DraftPart, type SavedView } from "@/lib/notes-db/views";

const VIEW_KEY = "pos-notes-view-v1";
const EXTRAS_KEY = "pos-notes-view-extras-v1";
/** Which saved view was open, and the filters / sorts not saved yet of each view (this browser only). */
const ACTIVE_KEY = "pos-notes-active-view-v1";
const DRAFTS_KEY = "pos-notes-view-drafts-v1";
/** Don't reload on every focus: at most every 15 s. */
const FOCUS_REFRESH_MS = 15_000;
/** A reload that started right after a change on screen could bring the value from before it: skip it. */
const LOCAL_GRACE_MS = 4_000;

type Extras = { cardSize: CardSize; hideEmpty: boolean };
const DEFAULT_EXTRAS: Extras = { cardSize: "medium", hideEmpty: false };

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, v: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode, full storage… the view just isn't remembered */
  }
}
function cleanExtras(raw: unknown): Extras {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const cardSize = o.cardSize === "small" || o.cardSize === "large" || o.cardSize === "medium" ? o.cardSize : DEFAULT_EXTRAS.cardSize;
  return { cardSize, hideEmpty: o.hideEmpty === true };
}

export default function Database({ data }: { data: DbData }) {
  const [notes, setNotes] = useState<DbNote[]>(data.notes);
  const [properties, setProperties] = useState<NoteProperty[]>(data.properties);
  const [templates, setTemplates] = useState<TemplateInfo[]>(data.templates);
  const [today, setToday] = useState(data.today);
  const [timezone, setTimezone] = useState(data.timezone);
  const [view, setView] = useState<ViewState>(() => defaultView(data.properties));
  const [extras, setExtras] = useState<Extras>(DEFAULT_EXTRAS);
  const [ready, setReady] = useState(false);
  const [openChip, setOpenChip] = useState<string | null>(null);
  // Saved views (the tabs). null = not available (migration 0037 not run): the view stays in this browser.
  const [savedViews, setSavedViews] = useState<SavedView[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const propsRef = useRef(properties);
  propsRef.current = properties;
  const lastLocal = useRef(0);
  const lastRefresh = useRef(0);
  const loading = useRef(false);

  const apply = useCallback((d: DbData) => {
    setNotes(d.notes);
    setProperties(d.properties);
    setTemplates(d.templates);
    setToday(d.today);
    setTimezone(d.timezone);
  }, []);

  // New data from the server (router.refresh(), coming back to the page…)
  const firstData = useRef(true);
  useEffect(() => {
    if (firstData.current) {
      firstData.current = false;
      return;
    }
    apply(data);
    lastRefresh.current = Date.now();
  }, [data, apply]);

  // The remembered view (after hydration, so the server HTML and the first browser render match), then
  // the saved views: the first time, the view of this browser becomes the first saved view.
  useEffect(() => {
    let cancelled = false;
    const saved = readJson(VIEW_KEY);
    const v = sanitizeView(saved, propsRef.current);
    if (!saved && typeof window !== "undefined" && window.matchMedia?.("(max-width: 639px)").matches) v.layout = "list";
    const localExtras = cleanExtras(readJson(EXTRAS_KEY));
    void (async () => {
      let list: SavedView[] | null = null;
      try {
        const r = await listNoteViews();
        if (r.ok) {
          list = r.views;
          if (!list.length) {
            // The first time: the 4 layouts become the first 4 views. The one this browser was using keeps its filters.
            const made: SavedView[] = [];
            for (const layout of ["table", "list", "gallery", "board"] as Layout[]) {
              const state = layout === v.layout ? { ...v, search: "" } : { ...defaultView(propsRef.current), layout };
              const c = await createNoteView({ name: LAYOUT_NAME[layout], state, extras: layout === v.layout ? localExtras : undefined });
              if (c.ok && c.view) made.push(c.view);
            }
            list = made.length ? made : null;
            if (list) {
              const mine = list.find((x) => x.state.layout === v.layout);
              if (mine) writeJson(ACTIVE_KEY, mine.id);
            }
          }
        }
      } catch {
        list = null;
      }
      if (cancelled) return;
      if (list && list.length) {
        const clean = list.map((x) => ({ ...x, state: sanitizeView(x.state, propsRef.current) }));
        const last = readJson(ACTIVE_KEY);
        const active = clean.find((x) => x.id === last) ?? clean[0];
        const drafts = (readJson(DRAFTS_KEY) ?? {}) as Record<string, DraftPart>;
        const working = drafts[active.id] ? sanitizeView({ ...active.state, ...drafts[active.id] }, propsRef.current) : active.state;
        setSavedViews(clean);
        setActiveId(active.id);
        setView(working);
        setExtras(active.extras);
      } else {
        setView(v);
        setExtras(localExtras);
      }
      lastRefresh.current = Date.now();
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (ready) writeJson(VIEW_KEY, view);
  }, [view, ready]);
  useEffect(() => {
    if (ready) writeJson(EXTRAS_KEY, extras);
  }, [extras, ready]);

  // ---- Saved views ----
  const activeSaved = useMemo(() => savedViews?.find((x) => x.id === activeId) ?? null, [savedViews, activeId]);
  const dirty = !!activeSaved && isDirty(view, activeSaved.state);

  // The filters / sorts not saved yet stay in this browser (a refresh keeps them); the open view too
  useEffect(() => {
    if (!ready || !activeSaved) return;
    const drafts = (readJson(DRAFTS_KEY) ?? {}) as Record<string, DraftPart>;
    if (isDirty(view, activeSaved.state)) drafts[activeSaved.id] = draftPart(view);
    else delete drafts[activeSaved.id];
    writeJson(DRAFTS_KEY, drafts);
    writeJson(ACTIVE_KEY, activeSaved.id);
  }, [view, activeSaved, ready]);

  // Layout, columns, widths, wrapping and card size save by themselves (a moment after the last change)
  useEffect(() => {
    if (!ready || !activeSaved) return;
    const extrasChanged = JSON.stringify(extras) !== JSON.stringify(activeSaved.extras);
    if (!autoPartChanged(view, activeSaved.state) && !extrasChanged) return;
    const id = activeSaved.id;
    const state = autoSavedState(view, activeSaved.state);
    const t = window.setTimeout(() => {
      void saveNoteView(id, { state, extras }).then((r) => {
        if (r.ok) setSavedViews((list) => list && list.map((x) => (x.id === id ? { ...x, state, extras } : x)));
        else toast(r.error ?? "Couldn't save the view.");
      });
    }, 800);
    return () => window.clearTimeout(t);
  }, [view, extras, activeSaved, ready]);

  /** Save right now what is waiting for the timer (before leaving the view). */
  const flushAuto = useCallback(() => {
    if (!activeSaved) return;
    const extrasChanged = JSON.stringify(extras) !== JSON.stringify(activeSaved.extras);
    if (!autoPartChanged(view, activeSaved.state) && !extrasChanged) return;
    const id = activeSaved.id;
    const state = autoSavedState(view, activeSaved.state);
    setSavedViews((list) => list && list.map((x) => (x.id === id ? { ...x, state, extras } : x)));
    void saveNoteView(id, { state, extras }).then((r) => {
      if (!r.ok) toast(r.error ?? "Couldn't save the view.");
    });
  }, [activeSaved, view, extras]);

  const showView = useCallback((target: SavedView) => {
    const drafts = (readJson(DRAFTS_KEY) ?? {}) as Record<string, DraftPart>;
    const working = drafts[target.id] ? sanitizeView({ ...target.state, ...drafts[target.id] }, propsRef.current) : target.state;
    setActiveId(target.id);
    setView(working);
    setExtras(target.extras);
    setOpenChip(null);
  }, []);
  const selectView = useCallback(
    (id: string) => {
      const target = savedViews?.find((x) => x.id === id);
      if (!target || id === activeId) return;
      flushAuto();
      showView(target);
    },
    [savedViews, activeId, flushAuto, showView],
  );
  const addView = useCallback(
    async (name: string, state: ViewState, ex: Extras) => {
      if (!savedViews || busy) return;
      if (savedViews.length >= MAX_VIEWS) return toast(`You can have up to ${MAX_VIEWS} views.`);
      setBusy(true);
      try {
        flushAuto();
        const r = await createNoteView({ name, state: { ...state, search: "" }, extras: ex });
        if (!r.ok || !r.view) return toast(r.error ?? "Couldn't create the view.");
        const made: SavedView = { ...r.view, state: sanitizeView(r.view.state, propsRef.current) };
        setSavedViews((list) => [...(list ?? []).filter((x) => x.id !== made.id), made]);
        showView(made);
      } finally {
        setBusy(false);
      }
    },
    [savedViews, busy, flushAuto, showView],
  );
  const onCreateView = useCallback(
    (layout: Layout) => {
      const names = (savedViews ?? []).map((x) => x.name);
      void addView(nextViewName(names, LAYOUT_NAME[layout]), { ...defaultView(propsRef.current), layout }, { cardSize: "medium", hideEmpty: false });
    },
    [savedViews, addView],
  );
  const onDuplicateView = useCallback(
    (id: string) => {
      const src = savedViews?.find((x) => x.id === id);
      if (!src) return;
      const names = savedViews!.map((x) => x.name);
      // The open view is copied as it looks now (with the filters on screen)
      void addView(copyName(names, src.name), id === activeId ? view : src.state, id === activeId ? extras : src.extras);
    },
    [savedViews, activeId, view, extras, addView],
  );
  const onRenameView = useCallback(
    (id: string, name: string) => {
      const prev = savedViews;
      setSavedViews((list) => list && list.map((x) => (x.id === id ? { ...x, name } : x)));
      void saveNoteView(id, { name }).then((r) => {
        if (!r.ok) {
          setSavedViews(prev);
          toast(r.error ?? "Couldn't rename the view.");
        }
      });
    },
    [savedViews],
  );
  const onDeleteView = useCallback(
    async (id: string) => {
      const target = savedViews?.find((x) => x.id === id);
      if (!savedViews || !target || busy) return;
      if (typeof window !== "undefined" && !window.confirm(`Delete the view “${target.name}”? Your notes are not deleted.`)) return;
      setBusy(true);
      try {
        const r = await deleteNoteView(id);
        if (!r.ok) return toast(r.error ?? "Couldn't delete the view.");
        const nextId = id === activeId ? afterDelete(savedViews, id) : activeId;
        const rest = savedViews.filter((x) => x.id !== id);
        setSavedViews(rest);
        const drafts = (readJson(DRAFTS_KEY) ?? {}) as Record<string, DraftPart>;
        delete drafts[id];
        writeJson(DRAFTS_KEY, drafts);
        if (id === activeId) {
          const next = rest.find((x) => x.id === nextId) ?? rest[0];
          if (next) showView(next);
        }
      } finally {
        setBusy(false);
      }
    },
    [savedViews, activeId, busy, showView],
  );
  const onReorderViews = useCallback(
    (ids: string[]) => {
      if (!savedViews) return;
      const prev = savedViews;
      setSavedViews(reorderedViews(savedViews, ids));
      void reorderNoteViews(ids).then((r) => {
        if (!r.ok) {
          setSavedViews(prev);
          toast(r.error ?? "Couldn't save the new order.");
        }
      });
    },
    [savedViews],
  );
  const onLayoutView = useCallback(
    (id: string, layout: Layout) => {
      if (id === activeId) {
        setView((v) => ({ ...v, layout })); // saves by itself
        return;
      }
      const target = savedViews?.find((x) => x.id === id);
      if (!target) return;
      const state = { ...target.state, layout };
      setSavedViews((list) => list && list.map((x) => (x.id === id ? { ...x, state } : x)));
      void saveNoteView(id, { state }).then((r) => {
        if (!r.ok) toast(r.error ?? "Couldn't save the view.");
      });
    },
    [activeId, savedViews],
  );
  const onSaveDraft = useCallback(async () => {
    if (!activeSaved || busy) return;
    setBusy(true);
    try {
      const state: ViewState = { ...view, search: "" };
      const r = await saveNoteView(activeSaved.id, { state, extras });
      if (!r.ok) return toast(r.error ?? "Couldn't save the view.");
      setSavedViews((list) => list && list.map((x) => (x.id === activeSaved.id ? { ...x, state, extras } : x)));
      toast("View saved.");
    } finally {
      setBusy(false);
    }
  }, [activeSaved, busy, view, extras]);
  const onResetDraft = useCallback(() => {
    if (activeSaved) setView((v) => resetDraft(v, activeSaved.state));
  }, [activeSaved]);

  // A tag was renamed / recolored / merged / deleted from a picker: update every note on screen at once
  useEffect(() => {
    const onTags = (e: Event) => {
      const change = (e as CustomEvent<TagChange>).detail;
      if (!change) return;
      lastLocal.current = Date.now();
      setNotes((list) => applyTagChangeToAll(list, change));
    };
    window.addEventListener(TAGS_CHANGED, onTags);
    return () => window.removeEventListener(TAGS_CHANGED, onTags);
  }, []);

  // Properties deleted / changed type since: clean the view (filters, sorts, columns, board)
  const propsKey = useMemo(() => properties.map((p) => `${p.id}:${p.type}`).join(","), [properties]);
  useEffect(() => {
    if (ready) setView((v) => sanitizeView(v, propsRef.current));
  }, [propsKey, ready]);

  // The column order is saved in the database (each property's position), so it is the same after a
  // reload and on every device. A view saved in this browser follows it.
  const orderKey = useMemo(() => properties.map((p) => `${p.id}:${p.position}`).join(","), [properties]);
  useEffect(() => {
    if (!ready) return;
    setView((v) => {
      const pos = new Map(propsRef.current.map((p) => [p.id, p.position]));
      const sorted = [...v.visible].sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0));
      return sorted.join() === v.visible.join() ? v : { ...v, visible: sorted };
    });
  }, [orderKey, ready]);

  // ---- Reloading ----
  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    const started = Date.now();
    lastRefresh.current = started;
    try {
      const r = await loadNotesDatabase();
      if (r.ok && r.data && lastLocal.current < started - LOCAL_GRACE_MS) apply(r.data);
    } catch {
      /* offline: keep what is on screen */
    } finally {
      loading.current = false;
    }
  }, [apply]);

  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastRefresh.current > FOCUS_REFRESH_MS) void refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) void refresh(); // back to the page from the browser's cache
    };
    const onChanged = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onShow);
    window.addEventListener(NOTES_DB_CHANGED, onChanged);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener(NOTES_DB_CHANGED, onChanged);
    };
  }, [refresh]);

  // ---- Changes from the views ----
  const onNote = useCallback((n: DbNote) => {
    lastLocal.current = Date.now();
    setNotes((list) => list.map((x) => (x.id === n.id ? n : x)));
  }, []);

  const onProps = useCallback((next: NoteProperty[]) => {
    lastLocal.current = Date.now();
    const old = new Set(propsRef.current.map((p) => p.id));
    const added = next.filter((p) => !old.has(p.id)).map((p) => p.id);
    propsRef.current = next;
    setProperties(next);
    // A property created from here shows as a column right away
    if (added.length) setView((v) => ({ ...v, visible: [...v.visible, ...added.filter((id) => !v.visible.includes(id))] }));
  }, []);

  // ---- The view ----
  const deferred = useDeferredValue(view); // typing in the search stays smooth with many notes
  const shown = useMemo(() => applyView(notes, properties, deferred, today, timezone), [notes, properties, deferred, today, timezone]);
  const filtering = useMemo(() => isFiltering(view, properties), [view, properties]);
  const byId = useMemo(() => new Map(properties.map((p) => [p.id, p])), [properties]);
  const cols = useMemo(() => view.visible.map((id) => byId.get(id)).filter((p): p is NoteProperty => !!p), [view.visible, byId]);
  const titles = useMemo(() => new Map(notes.map((n) => [n.id, displayTitle(n)])), [notes]);
  const exportNotes = useMemo(() => shown.map(exportOf), [shown]);
  const kindPropId = useMemo(() => properties.find((p) => p.type === "kind")?.id ?? null, [properties]);
  const groupProp = useMemo(() => {
    const p = view.groupBy ? byId.get(view.groupBy) : undefined;
    if (p && canGroupBy(p)) return p;
    const d = defaultGroupBy(properties);
    return d ? byId.get(d) ?? null : null;
  }, [view.groupBy, byId, properties]);

  const { quick, advanced } = view;
  const newValues = useMemo(() => valuesFromView({ ...defaultView([]), quick, advanced }, properties, today), [quick, advanced, properties, today]);

  const tags = useMemo(() => {
    const m = new Map<string, { name: string; color: string | null }>();
    for (const n of notes) for (const t of n.tags) if (!m.has(t.name.toLowerCase())) m.set(t.name.toLowerCase(), t);
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [notes]);
  const tagNames = useMemo(() => tags.map((t) => t.name), [tags]);

  const relationItems = useMemo(() => {
    const cache = new Map<string, RelatedItem[]>();
    return (propId: string) => {
      const hit = cache.get(propId);
      if (hit) return hit;
      const seen = new Map<string, RelatedItem>();
      for (const n of notes) for (const it of n.relations[propId] ?? []) if (!seen.has(`${it.type}:${it.id}`)) seen.set(`${it.type}:${it.id}`, it);
      const list = [...seen.values()].sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      cache.set(propId, list);
      return list;
    };
  }, [notes]);

  const env = useMemo<DbEnv>(
    () => ({ properties, templates, today, timezone, newValues, onNote, onProps, tagNames, relationItems, refresh: () => void refresh() }),
    [properties, templates, today, timezone, newValues, onNote, onProps, tagNames, relationItems, refresh],
  );
  const propEnv = useMemo<PropEnv>(() => ({ timezone, tags }), [timezone, tags]);

  // ---- Toolbar / table actions ----
  const onAddFilter = useCallback(
    (propId: string) => {
      const existing = view.quick.find((r) => r.prop === propId && r.id !== HIDE_BLOCKS_ID);
      if (existing) return setOpenChip(existing.id);
      const p = propId === "title" ? "title" : byId.get(propId);
      if (!p) return;
      const rule = newRule(p);
      setView((v) => ({ ...v, quick: [...v.quick, rule] }));
      setOpenChip(rule.id);
    },
    [view.quick, byId],
  );
  const onClearFilters = useCallback(() => {
    setOpenChip(null);
    setView((v) => ({ ...v, search: "", quick: [], advanced: null }));
  }, []);
  const onSort = useCallback((prop: string, dir: "asc" | "desc") => setView((v) => ({ ...v, sorts: [{ prop, dir }, ...v.sorts.filter((s) => s.prop !== prop)] })), []);
  /** "Wrap column" of one column ("title" = the name), or "all" = "Wrap all columns". */
  const onWrap = useCallback((id: string, on: boolean) => {
    setView((v) => {
      if (id === "all") return { ...v, wrapAll: on, wrap: on ? v.wrap : [] };
      const all = ["title", ...v.visible];
      const current = v.wrapAll ? all : v.wrap ?? [];
      // Turning one column off while "wrap all" is on: the others stay wrapped one by one
      return { ...v, wrapAll: false, wrap: on ? [...new Set([...current, id])] : current.filter((x) => x !== id) };
    });
  }, []);
  const onHide = useCallback((prop: string) => setView((v) => ({ ...v, visible: v.visible.filter((id) => id !== prop) })), []);
  // Shows / hides / moves columns. `ids` = the visible columns in their new order. A pure move is saved
  // in the database: the visible columns swap places among the slots they already had (hidden ones stay put).
  const viewRef = useRef(view);
  viewRef.current = view;
  const setVisible = useCallback((ids: string[]) => {
    const cur = viewRef.current.visible;
    const pure = ids.length === cur.length && ids.every((id) => cur.includes(id));
    if (!pure) {
      const pos = new Map(propsRef.current.map((p) => [p.id, p.position]));
      setView((v) => ({ ...v, visible: [...ids].sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0)) }));
      return;
    }
    if (ids.join() === cur.join()) return;
    const prev = propsRef.current;
    const sorted = [...prev].sort((a, b) => a.position - b.position);
    const inSet = new Set(ids);
    const queue = [...ids];
    const full = sorted.map((p) => (inSet.has(p.id) ? (queue.shift() as string) : p.id));
    const next = prev.map((p) => ({ ...p, position: full.indexOf(p.id) }));
    lastLocal.current = Date.now();
    propsRef.current = next;
    setProperties(next);
    setView((v) => ({ ...v, visible: ids }));
    void reorderProperties(full)
      .then((r) => {
        if (!r.ok) throw r;
      })
      .catch((e) => {
        propsRef.current = prev;
        setProperties(prev);
        toast(errorText(e, "Couldn't save the new order."));
      });
  }, []);
  // A column dragged in the table: it goes before `beforeId` (null = last)
  const onReorder = useCallback(
    (id: string, beforeId: string | null) => {
      const rest = viewRef.current.visible.filter((x) => x !== id);
      const at = beforeId ? rest.indexOf(beforeId) : rest.length;
      rest.splice(at < 0 ? rest.length : at, 0, id);
      setVisible(rest);
    },
    [setVisible],
  );
  const onWidth = useCallback((id: string, w: number) => setView((v) => ({ ...v, widths: { ...v.widths, [id]: w } })), []);
  const setCardSize = useCallback((cardSize: CardSize) => setExtras((x) => ({ ...x, cardSize })), []);
  const setHideEmpty = useCallback((hideEmpty: boolean) => setExtras((x) => ({ ...x, hideEmpty })), []);

  if (!ready) return <div className="db-root db-loading" aria-busy="true" />;

  let body: React.ReactNode;
  if (!notes.length) {
    body = (
      <div className="db-empty">
        <span className="db-empty-icon" aria-hidden>
          📝
        </span>
        <p className="font-medium text-fg">No notes yet</p>
        <p className="text-sm">Create your first note to start your database.</p>
        <NewNoteButton templates={templates} values={newValues} />
      </div>
    );
  } else if (!shown.length) {
    body = (
      <div className="db-empty">
        <span className="db-empty-icon" aria-hidden>
          ⌕
        </span>
        <p>
          No notes match these filters
          {filtering && (
            <>
              {" · "}
              <button type="button" className="db-link" onClick={onClearFilters}>
                Clear filters
              </button>
            </>
          )}
        </p>
      </div>
    );
  } else if (view.layout === "table") {
    body = <TableView notes={shown} cols={cols} widths={view.widths} sorts={view.sorts} titles={titles} onWidth={onWidth} onSort={onSort} onFilter={onAddFilter} onHide={onHide} onReorder={onReorder} wrap={view.wrap} wrapAll={view.wrapAll === true} onWrap={onWrap} />;
  } else if (view.layout === "list") {
    body = <ListView notes={shown} cols={cols} titles={titles} />;
  } else if (view.layout === "gallery") {
    body = <GalleryView notes={shown} cols={cols} titles={titles} size={extras.cardSize} />;
  } else {
    body = <BoardView notes={shown} cols={cols} groupProp={groupProp} titles={titles} hideEmpty={extras.hideEmpty} />;
  }

  return (
    <PropEnvContext.Provider value={propEnv}>
      <DbEnvContext.Provider value={env}>
        <div className="db-root" data-layout={view.layout}>
          {savedViews && activeId && (
            <ViewTabs
              views={savedViews}
              activeId={activeId}
              dirty={dirty}
              busy={busy}
              onSelect={selectView}
              onCreate={onCreateView}
              onRename={onRenameView}
              onDuplicate={onDuplicateView}
              onDelete={(id) => void onDeleteView(id)}
              onReorder={onReorderViews}
              onLayout={onLayoutView}
              onSave={() => void onSaveDraft()}
              onReset={onResetDraft}
            />
          )}
          <Toolbar
            view={view}
            setView={setView}
            setVisible={setVisible}
            count={shown.length}
            total={notes.length}
            filtering={filtering}
            openChip={openChip}
            setOpenChip={setOpenChip}
            onAddFilter={onAddFilter}
            onClearFilters={onClearFilters}
            kindPropId={kindPropId}
            cardSize={extras.cardSize}
            setCardSize={setCardSize}
            hideEmpty={extras.hideEmpty}
            setHideEmpty={setHideEmpty}
            showLayouts={!savedViews}
          />
          <BulkProvider notes={notes} tags={tags}>
            <NoteSelection notes={exportNotes}>
              <NotesExportBar extra={(ids) => <BulkEdit ids={ids} />} />
              <div className="db-view">{body}</div>
            </NoteSelection>
          </BulkProvider>
        </div>
      </DbEnvContext.Provider>
    </PropEnvContext.Provider>
  );
}
