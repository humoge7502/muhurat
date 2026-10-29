import { driver } from "driver.js";
import {
  AlarmClockPlus,
  Bell,
  CalendarDays,
  Clock3,
  Compass,
  GraduationCap,
  LayoutGrid,
  RefreshCw,
  Search,
  Sparkles,
  Trophy,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { api } from "./api";
import type { Opportunity, SourceStatus } from "./types";

type TypeFilter = "all" | "contest" | "hackathon" | "scholarship";
type Sort = "deadline" | "new" | "prize";

const TYPE_META: Record<Opportunity["type"], { label: string; classes: string }> = {
  contest: { label: "Contest", classes: "bg-cyan-400/10 text-cyan-300 border-cyan-400/30" },
  hackathon: { label: "Hackathon", classes: "bg-violet-400/10 text-violet-300 border-violet-400/30" },
  scholarship: { label: "Scholarship", classes: "bg-amber-400/10 text-amber-300 border-amber-400/30" },
};

const SAVED_KEY = "muhurat.saved";

function loadSaved(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const diff = (new Date(iso).getTime() - Date.now()) / 86400000;
  return Number.isFinite(diff) ? diff : null;
}

function countdown(iso: string | null): string {
  const days = daysUntil(iso);
  if (days === null) return "see source";
  if (days < 0) return "closed";
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return `${hours}h left`;
  }
  return `${Math.ceil(days)}d left`;
}

function urgency(iso: string | null): string {
  const days = daysUntil(iso);
  if (days === null) return "text-zinc-500 border-white/10";
  if (days < 1) return "text-rose-300 border-rose-400/40 bg-rose-400/10";
  if (days < 3) return "text-amber-300 border-amber-400/40 bg-amber-400/10";
  return "text-cyan-300 border-cyan-400/30 bg-cyan-400/10";
}

export default function App(): React.JSX.Element {
  const [items, setItems] = useState<Opportunity[]>([]);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("deadline");
  const [days, setDays] = useState<number | null>(null);
  const [saved, setSaved] = useState<string[]>(loadSaved);
  const [showSaved, setShowSaved] = useState(false);
  const firstCardRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (query.trim()) params.set("q", query.trim());
      if (days) params.set("days", String(days));
      params.set("sort", sort);
      const payload = await api.opportunities(`?${params.toString()}`);
      setItems(payload.items);
      setSources(payload.sources);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, query, days, sort]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await api.refresh();
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const toggleSaved = useCallback(async (opportunity: Opportunity) => {
    setSaved((previous) => {
      const next = previous.includes(opportunity.id)
        ? previous.filter((id) => id !== opportunity.id)
        : [...previous, opportunity.id];
      localStorage.setItem(SAVED_KEY, JSON.stringify(next));
      return next;
    });
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Muhurat reminder set", {
        body: `${opportunity.title} — flagged. Export the calendar for device alarms.`,
      });
    } else if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const savedItems = useMemo(() => items.filter((item) => saved.includes(item.id)), [items, saved]);
  const icsHref = `/api/ics?ids=${encodeURIComponent(saved.join(","))}`;

  const startTour = useCallback(() => {
    const driverObj = driver({
      popoverClass: "driver-popover-muhurat",
      showProgress: true,
      steps: [
        {
          element: "#brand",
          popover: {
            title: "Muhurat",
            description:
              "Your moment radar: real contests, hackathons and scholarships, with the deadlines that matter.",
          },
        },
        {
          element: "#type-pills",
          popover: { title: "Filter by what you want", description: "Contests, hackathons or scholarships — tap to focus." },
        },
        {
          element: "#search",
          popover: { title: "Search anything", description: "By name, organiser or tag. Results update as you type." },
        },
        {
          element: firstCardRef.current ?? "#opps",
          popover: {
            title: "Real opportunities",
            description:
              "Every card is live-ingested from a public source, with its link. The countdown tells you exactly how long you have.",
          },
        },
        {
          element: "#refresh",
          popover: {
            title: "Always current",
            description: "Sources refresh every 6 hours; tap anytime to pull the latest opportunities right now.",
          },
        },
      ],
    });
    driverObj.drive();
  }, []);

  useEffect(() => {
    if (!localStorage.getItem("muhurat.toured") && items.length > 0) {
      localStorage.setItem("muhurat.toured", "1");
      startTour();
    }
  }, [items.length, startTour]);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
      <header id="brand" className="flex flex-wrap items-center gap-3 pt-10 pb-8">
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 via-cyan-400 to-amber-400 shadow-lg shadow-violet-500/20">
          <Sparkles className="h-5 w-5 text-black" />
        </div>
        <div className="mr-auto">
          <h1 className="text-2xl font-black tracking-tight">
            <span className="aurora-text">Muhurat</span>
          </h1>
          <p className="text-xs text-zinc-500">never miss your moment · real sources, real deadlines</p>
        </div>
        <button
          id="saved"
          onClick={() => setShowSaved((value) => !value)}
          className="glass glass-hover flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
        >
          <CalendarDays className="h-4 w-4 text-amber-300" />
          <span className="font-semibold">{saved.length}</span>
          <span className="hidden text-zinc-400 sm:inline">saved</span>
        </button>
        <button
          id="refresh"
          onClick={onRefresh}
          disabled={refreshing}
          className="glass glass-hover flex items-center gap-2 rounded-xl px-3 py-2 text-sm disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 text-cyan-300 ${refreshing ? "animate-spin" : ""}`} />
          <span className="hidden text-zinc-300 sm:inline">{refreshing ? "Refreshing" : "Refresh"}</span>
        </button>
        <button onClick={startTour} className="glass glass-hover rounded-xl px-3 py-2 text-sm text-zinc-300">
          Tour
        </button>
      </header>

      <AnimatePresence>
        {showSaved && (
          <motion.section
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="glass mb-6 rounded-2xl p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-bold text-amber-300">
                <Bell className="h-4 w-4" /> Your reminders ({saved.length})
              </h2>
              <a
                href={icsHref}
                className={`rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-300 ${
                  saved.length ? "" : "pointer-events-none opacity-40"
                }`}
              >
                Download calendar (.ics)
              </a>
            </div>
            {savedItems.length === 0 ? (
              <p className="text-xs text-zinc-500">
                Tap the bell on any card to save it here, then export the .ics — your phone
                alarms handle the rest, even offline.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {savedItems.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 text-zinc-300">
                    <span className="truncate">{item.title}</span>
                    <span className={`rounded-md border px-2 py-0.5 text-xs ${urgency(item.deadline)}`}>
                      {countdown(item.deadline)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      <section className="mb-6 flex flex-wrap items-center gap-2">
        <div id="type-pills" className="flex flex-wrap gap-2">
          {(["all", "contest", "hackathon", "scholarship"] as TypeFilter[]).map((value) => (
            <button
              key={value}
              onClick={() => setTypeFilter(value)}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                typeFilter === value
                  ? "border-violet-400/60 bg-violet-400/15 text-violet-200"
                  : "border-white/10 bg-white/5 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {value === "all" ? (
                <span className="flex items-center gap-1.5">
                  <LayoutGrid className="h-3.5 w-3.5" /> All
                </span>
              ) : value === "contest" ? (
                <span className="flex items-center gap-1.5">
                  <Trophy className="h-3.5 w-3.5" /> Contests
                </span>
              ) : value === "hackathon" ? (
                <span className="flex items-center gap-1.5">
                  <Compass className="h-3.5 w-3.5" /> Hackathons
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <GraduationCap className="h-3.5 w-3.5" /> Scholarships
                </span>
              )}
            </button>
          ))}
        </div>
        <div id="search" className="glass ml-auto flex min-w-56 items-center gap-2 rounded-xl px-3 py-2">
          <Search className="h-4 w-4 text-zinc-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, organiser, tag…"
            className="w-full bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
          />
        </div>
        <select
          value={`${days ?? ""}|${sort}`}
          onChange={(event) => {
            const [nextDays, nextSort] = event.target.value.split("|");
            setDays(nextDays ? Number(nextDays) : null);
            setSort(nextSort as Sort);
          }}
          className="glass rounded-xl px-3 py-2 text-sm text-zinc-300 outline-none"
        >
          <option value="|deadline">Soonest deadline</option>
          <option value="7|deadline">Deadline ≤ 7 days</option>
          <option value="30|deadline">Deadline ≤ 30 days</option>
          <option value="|new">Newest found</option>
          <option value="|prize">Biggest prizes</option>
        </select>
      </section>

      <section id="opps" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading &&
          Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="glass h-48 animate-pulse rounded-2xl" />
          ))}
        {!loading && items.length === 0 && (
          <div className="glass col-span-full rounded-2xl p-10 text-center">
            <Clock3 className="mx-auto mb-3 h-8 w-8 text-zinc-600" />
            <p className="text-sm text-zinc-400">
              Nothing matches right now. Try clearing filters — or hit Refresh; new
              opportunities arrive as the sources publish them.
            </p>
          </div>
        )}
        <AnimatePresence mode="popLayout">
          {!loading &&
            items.map((item, index) => {
              const meta = TYPE_META[item.type];
              const isSaved = saved.includes(item.id);
              return (
                <motion.article
                  key={item.id}
                  ref={index === 0 ? firstCardRef : undefined}
                  layout
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 260, damping: 24, delay: Math.min(index * 0.03, 0.3) }}
                  className="glass glass-hover flex flex-col gap-3 rounded-2xl p-4"
                >
                  <div className="flex items-center gap-2">
                    <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${meta.classes}`}>
                      {meta.label}
                    </span>
                    <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${urgency(item.deadline)}`}>
                      {countdown(item.deadline)}
                    </span>
                    {item.deadline_is_estimate === 1 && item.deadline && (
                      <span className="text-[10px] text-zinc-500" title="Parsed from prose — confirm on the source page">
                        est.
                      </span>
                    )}
                    <button
                      onClick={() => toggleSaved(item)}
                      title={isSaved ? "Saved — tap to remove" : "Remind me"}
                      className={`ml-auto rounded-lg border p-1.5 transition ${
                        isSaved
                          ? "border-amber-400/50 bg-amber-400/15 text-amber-300"
                          : "border-white/10 text-zinc-500 hover:text-amber-300"
                      }`}
                    >
                      <AlarmClockPlus className="h-4 w-4" />
                    </button>
                  </div>
                  <a href={item.url} target="_blank" rel="noreferrer" className="group">
                    <h3 className="font-bold leading-snug text-zinc-100 group-hover:text-violet-200">
                      {item.title}
                    </h3>
                  </a>
                  <p className="line-clamp-2 text-xs text-zinc-500">{item.excerpt}</p>
                  <div className="mt-auto flex items-center justify-between text-[11px] text-zinc-500">
                    <span className="truncate">{item.org} · {item.source}</span>
                    {item.prize && <span className="font-bold text-amber-300/90">{item.prize}</span>}
                  </div>
                  {item.deadline && (
                    <p className="text-[11px] text-zinc-600">
                      {new Date(item.deadline).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  )}
                </motion.article>
              );
            })}
        </AnimatePresence>
      </section>

      <footer className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[11px] text-zinc-600">
        {sources.map((source) => (
          <span key={source.source} className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${source.last_ok ? "bg-emerald-400" : "bg-rose-400"}`} />
            {source.source}
            {source.last_ok && ` · ${source.last_count} live`}
          </span>
        ))}
        <span>every item links to its source · nothing simulated</span>
      </footer>
    </div>
  );
}
