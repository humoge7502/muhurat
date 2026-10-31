import { driver } from "driver.js";
import {
  AlarmClockPlus,
  ArrowUpRight,
  BellRing,
  CalendarDays,
  Compass,
  GraduationCap,
  LayoutGrid,
  RefreshCw,
  Search,
  Trophy,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { api } from "./api";
import type { Opportunity, SourceStatus } from "./types";

type TypeFilter = "all" | "contest" | "hackathon" | "scholarship";
type Sort = "deadline" | "new" | "prize";

const TYPE_META: Record<
  Opportunity["type"],
  { label: string; rail: string; text: string; ring: string }
> = {
  contest: { label: "Contest", rail: "rail-cyan", text: "text-cyan-300", ring: "#22d3ee" },
  hackathon: { label: "Hackathon", rail: "rail-violet", text: "text-violet-300", ring: "#a78bfa" },
  scholarship: {
    label: "Scholarship",
    rail: "rail-amber",
    text: "text-amber-300",
    ring: "#fbbf24",
  },
};

const SAVED_KEY = "muhurat.saved";
const RING_WINDOW_DAYS = 30;
const RING_CIRCUMFERENCE = 2 * Math.PI * 19; // r=19

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
    return `${hours}h`;
  }
  if (days < 10) return `${Math.ceil(days)}d ${Math.round((days % 1) * 24)}h`;
  return `${Math.ceil(days)}d`;
}

function urgencyClass(iso: string | null): string {
  const days = daysUntil(iso);
  if (days === null) return "text-zinc-500";
  if (days < 1) return "text-rose-300";
  if (days < 3) return "text-amber-300";
  return "text-cyan-300";
}

/** The signature element: a countdown arc whose remaining sweep maps to a
 *  30-day window, so urgency is visible as geometry before it is read. */
function DeadlineRing({ opportunity }: { opportunity: Opportunity }) {
  const days = daysUntil(opportunity.deadline);
  if (days === null) {
    return (
      <span className="font-mono2 text-[10px] text-zinc-500" title="No stated deadline — confirm on the source page">
        ROLLING
      </span>
    );
  }
  const fraction = Math.max(0, Math.min(1, days / RING_WINDOW_DAYS));
  const offset = RING_CIRCUMFERENCE * (1 - fraction);
  const color = days < 1 ? "#fb7185" : days < 3 ? "#fbbf24" : TYPE_META[opportunity.type].ring;
  return (
    <div className="relative grid h-11 w-11 place-items-center" title={`Deadline ${new Date(opportunity.deadline!).toLocaleString()}`}>
      <svg viewBox="0 0 44 44" className="h-11 w-11 -rotate-90">
        <circle cx="22" cy="22" r="19" fill="none" strokeWidth="2.5" className="ring-track" />
        <motion.circle
          cx="22"
          cy="22"
          r="19"
          fill="none"
          strokeWidth="2.5"
          stroke={color}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          initial={{ strokeDashoffset: RING_CIRCUMFERENCE }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }}
        />
      </svg>
      <span
        className="font-mono2 absolute text-[10px] font-semibold"
        style={{ color }}
      >
        {countdown(opportunity.deadline)}
      </span>
    </div>
  );
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

  const enablePush = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      alert("This browser does not support push updates.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;
    const registration = await navigator.serviceWorker.ready;
    const { public_key } = await fetch("/api/push/public-key").then((r) => r.json());
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: public_key,
    });
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    await fetch("/api/push/dispatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    alert("Push updates enabled — you will be notified as deadlines approach.");
  }, []);

  const savedItems = useMemo(() => items.filter((item) => saved.includes(item.id)), [items, saved]);
  const icsHref = `/api/ics?ids=${encodeURIComponent(saved.join(","))}`;

  const urgent = useMemo(
    () =>
      [...items]
        .filter((item) => item.deadline)
        .sort((a, b) => (a.deadline! < b.deadline! ? -1 : 1))
        .slice(0, 8),
    [items],
  );

  const counts = useMemo(() => {
    const by = { contest: 0, hackathon: 0, scholarship: 0 } as Record<string, number>;
    for (const item of items) by[item.type] += 1;
    return by;
  }, [items]);

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
              "The launch clock for student opportunities — real contests, hackathons and scholarships, ranked by the time you actually have.",
          },
        },
        {
          element: "#ticker",
          popover: { title: "The tape never sleeps", description: "The most urgent deadlines scroll here, live from the sources." },
        },
        {
          element: "#type-pills",
          popover: { title: "Pick your lane", description: "Contests, hackathons or scholarships." },
        },
        {
          element: firstCardRef.current ?? "#opps",
          popover: {
            title: "Read the ring",
            description:
              "Each arc empties as its deadline approaches — 30-day sweep. Every card links to its real source.",
          },
        },
        {
          element: "#refresh",
          popover: { title: "Always current", description: "Sources refresh every 6 hours; pull them anytime." },
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

  const tickerItems = urgent.length
    ? urgent
    : items.slice(0, 8);

  return (
    <div className="min-h-dvh">
      {/* ---------------------------------------------------------- header */}
      <header
        id="brand"
        className="sticky top-0 z-20 border-b border-white/5 backdrop-blur-md"
        style={{ background: "rgba(5, 6, 11, 0.78)" }}
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="mr-auto flex items-baseline gap-3">
            <span className="font-display text-xl font-bold tracking-[0.22em] text-zinc-100">
              MUHURAT
            </span>
            <span className="label hidden sm:inline">opportunity launch clock</span>
          </div>
          <button
            id="saved"
            onClick={() => setShowSaved((value) => !value)}
            className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-amber-400/40 hover:text-amber-300"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            <span className="font-mono2 text-xs font-semibold">{saved.length}</span>
          </button>
          <button
            id="refresh"
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-cyan-400/40 hover:text-cyan-300 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span className="hidden text-xs sm:inline">{refreshing ? "PULLING" : "REFRESH"}</span>
          </button>
          <button onClick={startTour} className="label rounded-lg border border-white/10 px-3 py-1.5 hover:text-zinc-300">
            tour
          </button>
          <button
            id="enable-push"
            onClick={enablePush}
            className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-zinc-300 transition hover:border-violet-400/40 hover:text-violet-300"
          >
            <BellRing className="h-3.5 w-3.5" />
            <span className="hidden text-xs sm:inline">updates</span>
          </button>
        </div>
        {/* ticker tape */}
        <div id="ticker" className="ticker py-1.5">
          <div className="ticker__track font-mono2 text-[11px] text-zinc-400">
            {[0, 1].map((copy) => (
              <span key={copy} className="flex shrink-0">
                {tickerItems.map((item) => (
                  <span key={`${copy}-${item.id}`} className="mx-6 inline-flex items-center gap-2">
                    <span className={urgencyClass(item.deadline)}>{countdown(item.deadline)}</span>
                    <span className="text-zinc-300">{item.title}</span>
                    <span className="text-zinc-600">✦</span>
                  </span>
                ))}
              </span>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        {/* ------------------------------------------------------- counters */}
        <section className="flex flex-wrap items-end justify-between gap-4 pt-10 pb-6">
          <div>
            <p className="label mb-1">on the clock right now</p>
            <p className="font-display text-5xl font-bold tracking-tight text-zinc-100">
              {loading ? "—" : items.length}
              <span className="ml-3 align-middle text-sm font-normal text-zinc-500">
                opportunities with their clocks running
              </span>
            </p>
          </div>
          <div className="flex gap-5 font-mono2 text-xs text-zinc-500">
            <span><span className="text-cyan-300">{counts.contest}</span> contests</span>
            <span><span className="text-violet-300">{counts.hackathon}</span> hackathons</span>
            <span><span className="text-amber-300">{counts.scholarship}</span> scholarships</span>
          </div>
        </section>

        <AnimatePresence>
          {showSaved && (
            <motion.section
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="panel mb-6 overflow-hidden !rounded-2xl p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="label !text-amber-300/90">your reminders ({saved.length})</h2>
                <a
                  href={icsHref}
                  className={`font-mono2 rounded-lg border border-amber-400/40 px-3 py-1.5 text-[11px] font-semibold text-amber-300 ${
                    saved.length ? "hover:bg-amber-400/10" : "pointer-events-none opacity-40"
                  }`}
                >
                  ↓ export .ics (with 48h alarms)
                </a>
              </div>
              {savedItems.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  Flag any card, then export the calendar — your phone alarms handle
                  the rest, even offline.
                </p>
              ) : (
                <ul className="divide-y divide-white/5 text-sm">
                  {savedItems.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-zinc-300">
                      <span className="truncate">{item.title}</span>
                      <span className={`font-mono2 text-xs ${urgencyClass(item.deadline)}`}>
                        {countdown(item.deadline)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </motion.section>
          )}
        </AnimatePresence>

        {/* --------------------------------------------------------- filters */}
        <section className="mb-6 flex flex-wrap items-center gap-2">
          <div id="type-pills" className="flex flex-wrap gap-1.5">
            {(["all", "contest", "hackathon", "scholarship"] as TypeFilter[]).map((value) => (
              <button
                key={value}
                onClick={() => setTypeFilter(value)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition ${
                  typeFilter === value
                    ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-200"
                    : "border-white/8 text-zinc-500 hover:border-white/20 hover:text-zinc-300"
                }`}
              >
                {value === "all" ? <LayoutGrid className="h-3.5 w-3.5" /> : value === "contest" ? (
                  <Trophy className="h-3.5 w-3.5" />
                ) : value === "hackathon" ? (
                  <Compass className="h-3.5 w-3.5" />
                ) : (
                  <GraduationCap className="h-3.5 w-3.5" />
                )}
                {value === "all" ? "All" : TYPE_META[value].label + "s"}
              </button>
            ))}
          </div>
          <div
            id="search"
            className="ml-auto flex min-w-52 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5"
          >
            <Search className="h-3.5 w-3.5 text-zinc-600" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, organiser, tag…"
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
            className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[13px] text-zinc-300 outline-none"
          >
            <option value="|deadline">Soonest</option>
            <option value="7|deadline">≤ 7 days</option>
            <option value="30|deadline">≤ 30 days</option>
            <option value="|new">Newest</option>
            <option value="|prize">Biggest prizes</option>
          </select>
        </section>

        {/* ------------------------------------------------------- feed grid */}
        <section id="opps" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {loading &&
            Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="panel skeleton h-44" />
            ))}
          {!loading && items.length === 0 && (
            <div className="panel col-span-full p-10 text-center">
              <p className="font-display text-zinc-300">Nothing on the clock for that filter.</p>
              <p className="mt-1 text-xs text-zinc-500">
                Clear the filters or hit REFRESH — new items land as sources publish them.
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
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{
                      type: "spring",
                      stiffness: 300,
                      damping: 26,
                      delay: Math.min(index * 0.025, 0.25),
                    }}
                    className="panel flex flex-col gap-2.5 p-4 pl-5"
                  >
                    <span className={`panel__rail ${meta.rail}`} aria-hidden="true" />
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`label !text-[10px] ${meta.text}`}>{meta.label}</span>
                        <span className="text-white/10">/</span>
                        <span className="label">{item.source}</span>
                      </div>
                      <DeadlineRing opportunity={item} />
                    </div>
                    <a href={item.url} target="_blank" rel="noreferrer" className="group">
                      <h3 className="font-display text-[15px] font-medium leading-snug text-zinc-100 transition group-hover:text-cyan-200">
                        {item.title}
                        <ArrowUpRight className="ml-1 inline h-3.5 w-3.5 opacity-0 transition group-hover:opacity-60" />
                      </h3>
                    </a>
                    {item.excerpt && (
                      <p className="line-clamp-2 text-xs leading-relaxed text-zinc-500">{item.excerpt}</p>
                    )}
                    <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                      <span className="font-mono2 text-[10px] text-zinc-600">
                        {item.org}
                        {item.prize ? ` · ${item.prize}` : ""}
                      </span>
                      <button
                        onClick={() => toggleSaved(item)}
                        title={isSaved ? "Saved — tap to remove" : "Remind me"}
                        className={`rounded-md border p-1.5 transition ${
                          isSaved
                            ? "border-amber-400/50 bg-amber-400/10 text-amber-300"
                            : "border-white/10 text-zinc-600 hover:border-amber-400/40 hover:text-amber-300"
                        }`}
                      >
                        <AlarmClockPlus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </motion.article>
                );
              })}
          </AnimatePresence>
        </section>

        {/* -------------------------------------------------------- provenance */}
        <footer className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          {sources.map((source) => (
            <span key={source.source} className="label flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${source.last_ok ? "bg-emerald-400" : "bg-rose-400"}`} />
              {source.source}
              {source.last_ok && <span className="text-zinc-400">{source.last_count} live</span>}
            </span>
          ))}
          <span className="label">every item links to its source · nothing simulated</span>
        </footer>
      </main>
    </div>
  );
}
