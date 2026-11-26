"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { onValue, ref, remove, set, update } from "firebase/database";
import QRCode from "qrcode";
import CyberShield3D from "@/components/CyberShield3D";
import { db, firebaseConfigured, PATHS } from "@/lib/firebase";
import {
  DEFAULT_STATE,
  getScenario,
  parseState,
  tallyVotes,
  type ActiveScenario,
  type PulseState,
} from "@/lib/scenarios";

const noopSubscribe = () => () => {};
const EMPTY_COUNTS = { trust: 0, verify: 0, total: 0 };

/** Smoothly tweens a displayed number toward its target. */
function useAnimatedNumber(target: number, duration = 700): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const valueRef = useRef(target);

  useEffect(() => {
    fromRef.current = valueRef.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = fromRef.current + (target - fromRef.current) * eased;
      valueRef.current = v;
      setValue(v);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}

function mixHex(t: number): string {
  // cyan #00F0FF → amber #F59E0B → red #EF4444
  const stops = [
    [0, 240, 255],
    [245, 158, 11],
    [239, 68, 68],
  ];
  const x = Math.min(1, Math.max(0, t)) * 2;
  const i = Math.min(1, Math.floor(x));
  const f = x - i;
  const [a, b] = [stops[i], stops[i + 1]];
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function VulnerabilityGauge({ percent, compact = false }: { percent: number; compact?: boolean }) {
  const shown = useAnimatedNumber(percent);
  const color = mixHex(shown / 100);
  // 240° arc gauge
  const r = 88;
  const circumference = 2 * Math.PI * r;
  const arc = circumference * (240 / 360);
  const filled = arc * (shown / 100);

  return (
    <div
      className={`relative mx-auto aspect-square w-full transition-[max-width] duration-500 ${compact ? "max-w-[12rem]" : "max-w-[19rem]"}`}
    >
      <svg viewBox="0 0 200 200" className="h-full w-full -rotate-[210deg]">
        <circle
          cx="100"
          cy="100"
          r={r}
          fill="none"
          stroke="rgba(148,163,184,0.15)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${arc} ${circumference}`}
        />
        <circle
          cx="100"
          cy="100"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          style={{ filter: `drop-shadow(0 0 10px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`font-black leading-none tabular-nums ${compact ? "text-6xl" : "text-[5.5rem]"}`}
          style={{ color, textShadow: `0 0 30px ${color}` }}
        >
          {Math.round(shown)}
          <span className={compact ? "text-3xl" : "text-5xl"}>%</span>
        </span>
        <span className="mt-2 font-mono text-xs uppercase tracking-[0.3em] text-slate-400">
          {shown < 20
            ? "Secure"
            : shown < 50
              ? "Exposed"
              : shown < 75
                ? "Breached"
                : "Critical"}
        </span>
      </div>
    </div>
  );
}

function QrModal({
  url,
  qr,
  onClose,
}: {
  url: string;
  qr: string | null;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-up"
      onClick={onClose}
    >
      <div
        className="flex max-h-[94vh] flex-col items-center rounded-3xl bg-white px-12 py-10 text-slate-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-4xl font-black tracking-tight">Join the vote</p>
        <p className="mt-1 text-lg text-slate-600">
          Scan with your phone camera
        </p>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt={`QR code to ${url}`}
            className="my-6 h-[min(60vh,32rem)] w-[min(60vh,32rem)] [image-rendering:pixelated]"
          />
        ) : (
          <div className="my-6 h-[min(60vh,32rem)] w-[min(60vh,32rem)] animate-pulse rounded-xl bg-slate-200" />
        )}
        <p className="font-mono text-2xl font-bold break-all text-center">
          {url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-6 rounded-full bg-slate-900 px-8 py-3 text-base font-semibold text-white hover:bg-slate-700"
        >
          Fermer
        </button>
      </div>
    </div>
  );
}

function NotConfiguredBanner({ demo = false }: { demo?: boolean }) {
  if (demo)
    return (
      <div className="relative z-30 bg-fuchsia-500 px-4 py-2 text-center text-sm font-semibold text-white">
        Mode démo : les votes sont simulés. Touches 1-3 pour changer de
        scénario, R pour révéler l&apos;analyse.
      </div>
    );
  if (firebaseConfigured) return null;
  return (
    <div className="relative z-30 bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-slate-950">
      Firebase n&apos;est pas configuré : l&apos;interface s&apos;affiche mais
      les votes sont désactivés.
    </div>
  );
}

/** Share of naive "trust" votes simulated per scenario in demo mode. */
const DEMO_TRUST_BIAS: Record<number, number> = { 1: 0.68, 2: 0.45, 3: 0.3 };
const DEMO_ROOM_SIZE = 46;

export default function StagePage() {
  // Demo mode (/stage/?demo): local state + simulated audience, no Firebase.
  const demo = useSyncExternalStore(
    noopSubscribe,
    () => new URLSearchParams(window.location.search).has("demo"),
    () => false,
  );
  const [liveState, setLiveState] = useState<PulseState>(DEFAULT_STATE);
  const [demoState, setDemoState] = useState<PulseState>(DEFAULT_STATE);
  const [demoVotes, setDemoVotes] = useState<
    Record<number, typeof EMPTY_COUNTS>
  >({});
  const state = demo ? demoState : liveState;
  const [votesSnap, setVotesSnap] = useState<{
    scenario: number;
    counts: typeof EMPTY_COUNTS;
  }>({
    scenario: 0,
    counts: EMPTY_COUNTS,
  });
  const [connected, setConnected] = useState(false);
  const [showQr, setShowQr] = useState(false);
  // Audience URL = site origin + base path (e.g. https://user.github.io/trust-pulse/)
  const origin = useSyncExternalStore(
    noopSubscribe,
    () =>
      `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`,
    () => "",
  );
  const [qr, setQr] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Join URL + QR code
  useEffect(() => {
    if (!origin) return;
    QRCode.toDataURL(origin, {
      width: 720,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#020617", light: "#ffffff" },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, [origin]);

  // Live session state + connection
  useEffect(() => {
    if (demo) return;
    const unsubState = onValue(ref(db, PATHS.state), (snap) =>
      setLiveState(parseState(snap.val())),
    );
    const unsubConn = onValue(ref(db, ".info/connected"), (snap) =>
      setConnected(snap.val() === true),
    );
    return () => {
      unsubState();
      unsubConn();
    };
  }, [demo]);

  // Live votes on the active scenario
  const active = state.activeScenario;
  useEffect(() => {
    if (demo || active === 0) return;
    const unsub = onValue(ref(db, PATHS.scenarioVotes(active)), (snap) =>
      setVotesSnap({ scenario: active, counts: tallyVotes(snap.val()) }),
    );
    return () => unsub();
  }, [active, demo]);

  // Demo: votes trickle in like a real room (fast at first, then slower)
  useEffect(() => {
    if (!demo || active === 0) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      let done = false;
      setDemoVotes((prev) => {
        const c = prev[active] ?? EMPTY_COUNTS;
        if (c.total >= DEMO_ROOM_SIZE) {
          done = true;
          return prev;
        }
        const trust = Math.random() < DEMO_TRUST_BIAS[active] ? 1 : 0;
        return {
          ...prev,
          [active]: {
            trust: c.trust + trust,
            verify: c.verify + 1 - trust,
            total: c.total + 1,
          },
        };
      });
      if (!done) timer = setTimeout(tick, 120 + Math.random() * 650);
    };
    timer = setTimeout(tick, 900);
    return () => clearTimeout(timer);
  }, [demo, active]);

  const counts = demo
    ? (active !== 0 && demoVotes[active]) || EMPTY_COUNTS
    : active !== 0 && votesSnap.scenario === active
      ? votesSnap.counts
      : EMPTY_COUNTS;

  const scenario = active === 0 ? undefined : getScenario(active);
  const trustRatio = counts.total > 0 ? counts.trust / counts.total : 0;
  const vulnerability = Math.round(trustRatio * 100);
  const trustPct = counts.total > 0 ? (counts.trust / counts.total) * 100 : 0;
  const verifyPct = counts.total > 0 ? 100 - trustPct : 0;
  const animatedTotal = Math.round(useAnimatedNumber(counts.total, 400));

  // ---------- Presenter actions ----------
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Firebase write failed");
    } finally {
      setBusy(false);
    }
  }, []);

  const goTo = useCallback(
    (id: ActiveScenario) =>
      demo
        ? setDemoState({ activeScenario: id, revealExplanation: false })
        : run(() =>
            update(ref(db, PATHS.state), {
              activeScenario: id,
              revealExplanation: false,
            }),
          ),
    [run, demo],
  );

  const toggleReveal = useCallback(
    () =>
      demo
        ? setDemoState((s) => ({
            ...s,
            revealExplanation: !s.revealExplanation,
          }))
        : run(() =>
            update(ref(db, PATHS.state), {
              revealExplanation: !state.revealExplanation,
            }),
          ),
    [run, demo, state.revealExplanation],
  );

  const resetAll = useCallback(
    () =>
      demo
        ? (setDemoVotes({}),
          setDemoState(DEFAULT_STATE),
          setConfirmReset(false))
        : run(async () => {
            await remove(ref(db, PATHS.votes));
            await set(ref(db, PATHS.state), DEFAULT_STATE);
            setConfirmReset(false);
          }),
    [run, demo],
  );

  // Auto-cancel the reset confirmation
  useEffect(() => {
    if (!confirmReset) return;
    const t = setTimeout(() => setConfirmReset(false), 4000);
    return () => clearTimeout(t);
  }, [confirmReset]);

  // Keyboard shortcuts: 0–3 scenarios, R reveal, Q QR code, Esc close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") setShowQr(false);
      else if (["0", "1", "2", "3"].includes(e.key))
        goTo(Number(e.key) as ActiveScenario);
      else if (e.key === "r" || e.key === "R") toggleReveal();
      else if (e.key === "q" || e.key === "Q") setShowQr((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, toggleReveal]);

  const navButtons: { id: ActiveScenario; label: string }[] = [
    { id: 0, label: "Attente (0)" },
    { id: 1, label: "Scénario 1" },
    { id: 2, label: "Scénario 2" },
    { id: 3, label: "Scénario 3" },
  ];

  return (
    <main className="relative flex h-dvh w-full flex-col overflow-hidden bg-[#050811] text-slate-100">
      <NotConfiguredBanner demo={demo} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(0,240,255,0.08),transparent_55%)]" />
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-1000 bg-[radial-gradient(circle_at_30%_50%,rgba(239,68,68,0.16),transparent_60%)]"
        style={{ opacity: trustRatio }}
      />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between px-10 pt-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-cyan-300/70">
            The Art of the Con — Legacy of Deception
          </p>
          <h1 className="text-3xl font-black tracking-tight">
            The Trust <span className="text-[#00F0FF]">Pulse</span>
          </h1>
        </div>
        <div className="flex items-center gap-3 font-mono text-sm uppercase tracking-widest">
          <span
            className={`h-3 w-3 rounded-full ${connected || demo ? "bg-emerald-400 shadow-[0_0_12px_#34d399]" : "bg-red-500"}`}
          />
          <span
            className={connected || demo ? "text-emerald-300" : "text-red-400"}
          >
            {demo ? "Demo" : connected ? "Live" : "Offline"}
          </span>
        </div>
      </header>

      {/* Main stage */}
      <div className="relative z-0 flex min-h-0 flex-1">
        {/* 3D shield */}
        <div className="relative min-w-0 flex-[1.45]">
          <CyberShield3D
            trustRatio={trustRatio}
            totalVotes={counts.total}
            className="absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_55%,transparent_80%)]"
          />
        </div>

        {/* Live panel */}
        <aside className="relative flex min-w-0 flex-1 flex-col justify-center gap-6 overflow-y-auto py-6 pr-10 pl-4">
          {!scenario ? (
            <div className="flex flex-col items-start animate-fade-up">
              <p className="font-mono text-sm uppercase tracking-[0.3em] text-cyan-300">
                Standby
              </p>
              <h2 className="mt-3 text-5xl font-black leading-tight">
                Take out your phone.
                <br />
                <span className="text-[#00F0FF]">Join the experiment.</span>
              </h2>
              <div className="mt-8 flex items-center gap-8">
                {qr && (
                  <div className="rounded-2xl bg-white p-3 shadow-[0_0_50px_rgba(0,240,255,0.25)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qr}
                      alt="QR code to join"
                      className="h-52 w-52 [image-rendering:pixelated]"
                    />
                  </div>
                )}
                <div>
                  <p className="text-lg text-slate-400">Scan or open</p>
                  <p className="mt-1 font-mono text-3xl font-bold break-all text-white">
                    {origin.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </p>
                  <p className="mt-4 text-lg text-slate-400">
                    3 dilemmas. Anonymous votes. Real-time results.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div
              key={scenario.id}
              className="flex flex-col gap-6 animate-fade-up"
            >
              {/* Gauge */}
              <div className="rounded-3xl border border-slate-800 bg-slate-950/60 p-6 backdrop-blur">
                <p className="text-center text-xl font-bold uppercase tracking-[0.18em] text-slate-300">
                  Room Vulnerability Index
                </p>
                <VulnerabilityGauge percent={vulnerability} compact={state.revealExplanation} />
                <p className="-mt-6 text-center text-2xl text-slate-300">
                  <span className="font-black tabular-nums text-white">
                    {animatedTotal}
                  </span>{" "}
                  {counts.total === 1 ? "vote" : "votes"} live
                </p>
              </div>

              {/* Question */}
              <div>
                <p className="font-mono text-base uppercase tracking-[0.25em] text-cyan-300">
                  {scenario.title}
                </p>
                <p className="mt-3 text-[1.65rem] font-semibold leading-snug text-white">
                  {scenario.prompt}
                </p>
              </div>

              {/* Distribution bar */}
              <div>
                <div className="flex h-14 w-full overflow-hidden rounded-2xl bg-slate-800/70 ring-1 ring-slate-700">
                  <div
                    className="flex items-center justify-start bg-gradient-to-r from-red-600 to-red-500 pl-4 text-xl font-black text-white transition-[width] duration-700 ease-out"
                    style={{ width: `${trustPct}%` }}
                  >
                    {trustPct >= 12 && `${Math.round(trustPct)}%`}
                  </div>
                  <div
                    className="flex items-center justify-end bg-gradient-to-r from-cyan-500 to-[#00F0FF] pr-4 text-xl font-black text-slate-950 transition-[width] duration-700 ease-out"
                    style={{ width: `${verifyPct}%` }}
                  >
                    {verifyPct >= 12 && `${Math.round(verifyPct)}%`}
                  </div>
                </div>
                <div className="mt-3 flex justify-between text-lg font-semibold">
                  <span className="text-red-400">
                    Trust / Compromised{" "}
                    <span className="tabular-nums text-red-300/80">
                      ({counts.trust})
                    </span>
                  </span>
                  <span className="text-[#00F0FF]">
                    <span className="tabular-nums text-cyan-200/80">
                      ({counts.verify})
                    </span>{" "}
                    Verified / Secure
                  </span>
                </div>
                <div className="mt-1 flex justify-between gap-6 text-sm text-slate-500">
                  <span className="max-w-[48%]">{scenario.trustLabel}</span>
                  <span className="max-w-[48%] text-right">
                    {scenario.verifyLabel}
                  </span>
                </div>
              </div>

              {/* Reveal */}
              {state.revealExplanation && (
                <div className="animate-fade-up rounded-3xl border-2 border-amber-400/60 bg-amber-400/10 p-6 shadow-[0_0_40px_rgba(245,158,11,0.15)]">
                  <p className="font-mono text-sm uppercase tracking-[0.3em] text-amber-300">
                    Psychological lever
                  </p>
                  <p className="mt-1 text-2xl font-black text-amber-100">
                    {scenario.lever}
                  </p>
                  <p className="mt-4 font-mono text-sm uppercase tracking-[0.3em] text-amber-300">
                    Exploited flaw
                  </p>
                  <p className="mt-1 text-xl leading-relaxed text-amber-50">
                    {scenario.trapExplanation}
                  </p>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Presenter control bar — discreet until hovered */}
      <footer className="group relative z-20 flex items-center justify-center pb-3 pt-2">
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-800/80 bg-slate-950/80 px-3 py-2 opacity-25 backdrop-blur transition-opacity duration-300 hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={() => setShowQr(true)}
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-bold text-slate-950 hover:bg-cyan-100"
          >
            QR Code Salle
          </button>
          <span className="mx-1 h-6 w-px bg-slate-700" />
          {navButtons.map((b) => (
            <button
              key={b.id}
              type="button"
              disabled={busy}
              onClick={() => goTo(b.id)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
                active === b.id
                  ? "bg-[#00F0FF] text-slate-950"
                  : "bg-slate-800 text-slate-200 hover:bg-slate-700"
              }`}
            >
              {b.label}
            </button>
          ))}
          <span className="mx-1 h-6 w-px bg-slate-700" />
          <button
            type="button"
            disabled={busy || active === 0}
            onClick={toggleReveal}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-40 ${
              state.revealExplanation
                ? "bg-amber-400 text-slate-950"
                : "bg-slate-800 text-amber-300 hover:bg-slate-700"
            }`}
          >
            {state.revealExplanation
              ? "Masquer l'analyse"
              : "Révéler l'analyse"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => (confirmReset ? resetAll() : setConfirmReset(true))}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ${
              confirmReset
                ? "bg-red-600 text-white animate-pulse"
                : "bg-slate-800 text-red-400 hover:bg-red-950"
            }`}
          >
            {confirmReset ? "Confirmer le reset ?" : "Reset Votes"}
          </button>
          {actionError && (
            <span className="ml-2 text-xs text-red-400">{actionError}</span>
          )}
          <span className="ml-2 hidden font-mono text-[10px] text-slate-500 xl:inline">
            0-3 · R · Q
          </span>
        </div>
      </footer>

      {showQr && (
        <QrModal url={origin} qr={qr} onClose={() => setShowQr(false)} />
      )}
    </main>
  );
}
