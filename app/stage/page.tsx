"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
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
type Counts = typeof EMPTY_COUNTS;

/** Share of naive "trust" votes simulated per scenario in demo mode. */
const DEMO_TRUST_BIAS: Record<number, number> = { 1: 0.68, 2: 0.45, 3: 0.3 };
const DEMO_ROOM_SIZE = 46;

/** Smoothly tweens a displayed number toward its target. */
function useAnimatedNumber(target: number, duration = 700): number {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);

  useEffect(() => {
    const from = valueRef.current;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const v = from + (target - from) * (1 - Math.pow(1 - p, 3));
      valueRef.current = v;
      setValue(v);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}

/** Secure cyan → neutral white → alarm red. */
function riskColor(t: number): string {
  const stops = [
    [0, 240, 255],
    [241, 245, 249],
    [239, 68, 68],
  ];
  const x = Math.min(1, Math.max(0, t)) * 2;
  const i = Math.min(1, Math.floor(x));
  const f = x - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

function displayUrl(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function VulnerabilityIndex({ counts, compact }: { counts: Counts; compact: boolean }) {
  const ratio = counts.total > 0 ? counts.trust / counts.total : 0;
  const shown = useAnimatedNumber(ratio * 100);
  const total = Math.round(useAnimatedNumber(counts.total, 400));
  const color = riskColor(shown / 100);
  const trustPct = ratio * 100;

  return (
    <div>
      <div className="flex items-end justify-between gap-6">
        <p
          className={`leading-[0.8] font-semibold tracking-[-0.04em] tabular-nums transition-[font-size] duration-500 ${
            compact ? "text-[clamp(2.5rem,min(8vh,5vw),6rem)]" : "text-[clamp(3rem,min(13vh,8vw),10rem)]"
          }`}
          style={{ color }}
        >
          {Math.round(shown)}%
        </p>
        <p className="pb-1 text-right text-[clamp(0.85rem,min(2.2vh,1.4vw),1.5rem)] leading-tight text-slate-400">
          Room
          <br />
          Vulnerability Index
        </p>
      </div>

      <div className="mt-[3vh] flex h-[clamp(0.4rem,1.1vh,0.75rem)] gap-1 overflow-hidden rounded-full" aria-hidden>
        {counts.total === 0 ? (
          <div className="h-full w-full rounded-full bg-white/10" />
        ) : (
          <>
            <div
              className="h-full rounded-full bg-alarm transition-[width] duration-700 ease-out"
              style={{ width: `${trustPct}%` }}
            />
            <div
              className="h-full flex-1 rounded-full bg-secure transition-[width] duration-700 ease-out"
              style={{ minWidth: trustPct >= 100 ? 0 : undefined }}
            />
          </>
        )}
      </div>

      <div className="mt-[1.5vh] flex justify-between gap-4 text-[clamp(0.85rem,min(2.2vh,1.4vw),1.5rem)]">
        <span className="text-slate-300">
          <span className="font-semibold text-alarm tabular-nums">{counts.trust}</span> Trust / Compromised
        </span>
        <span className="text-slate-300">
          Verified / Secure <span className="font-semibold text-secure tabular-nums">{counts.verify}</span>
        </span>
      </div>
      <p className="mt-[0.8vh] text-[clamp(0.8rem,min(1.7vh,1.1vw),1.125rem)] text-slate-500 tabular-nums">
        {total} {total === 1 ? "vote" : "votes"} so far
      </p>
    </div>
  );
}

function QrModal({ url, qr, onClose }: { url: string; qr: string | null; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-night/85 backdrop-blur-md"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Join the vote"
    >
      <div
        className="flex flex-col items-center rounded-[2rem] bg-white px-14 pt-12 pb-10 text-slate-950"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-4xl font-semibold tracking-tight">Scan to vote</p>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt={`QR code for ${url}`} className="my-8 size-[min(58vh,30rem)] [image-rendering:pixelated]" />
        ) : (
          <div className="my-8 size-[min(58vh,30rem)] rounded-xl bg-slate-100" />
        )}
        <p className="text-2xl font-medium">{displayUrl(url)}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-8 rounded-full bg-slate-950 px-7 py-3 text-base font-medium text-white hover:bg-slate-800"
        >
          Fermer
        </button>
      </div>
    </div>
  );
}

export default function StagePage() {
  // Demo mode (/stage/?demo): local state + simulated audience, no Firebase.
  const demo = useSyncExternalStore(
    noopSubscribe,
    () => new URLSearchParams(window.location.search).has("demo"),
    () => false
  );
  const [liveState, setLiveState] = useState<PulseState>(DEFAULT_STATE);
  const [demoState, setDemoState] = useState<PulseState>(DEFAULT_STATE);
  const [demoVotes, setDemoVotes] = useState<Record<number, Counts>>({});
  const [votesSnap, setVotesSnap] = useState<{ scenario: number; counts: Counts }>({
    scenario: 0,
    counts: EMPTY_COUNTS,
  });
  const [connected, setConnected] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const state = demo ? demoState : liveState;

  // Audience URL = site origin + base path (e.g. https://user.github.io/repo/)
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`,
    () => ""
  );

  useEffect(() => {
    if (!origin) return;
    QRCode.toDataURL(origin, { width: 720, margin: 1, errorCorrectionLevel: "M", color: { dark: "#050811", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [origin]);

  // Live session state + connection
  useEffect(() => {
    if (demo) return;
    const unsubState = onValue(ref(db, PATHS.state), (snap) => setLiveState(parseState(snap.val())));
    const unsubConn = onValue(ref(db, ".info/connected"), (snap) => setConnected(snap.val() === true));
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
      setVotesSnap({ scenario: active, counts: tallyVotes(snap.val()) })
    );
    return () => unsub();
  }, [active, demo]);

  // Demo: votes trickle in like a real room
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
        return { ...prev, [active]: { trust: c.trust + trust, verify: c.verify + 1 - trust, total: c.total + 1 } };
      });
      if (!done) timer = setTimeout(tick, 120 + Math.random() * 650);
    };
    timer = setTimeout(tick, 900);
    return () => clearTimeout(timer);
  }, [demo, active]);

  const counts: Counts = demo
    ? (active !== 0 && demoVotes[active]) || EMPTY_COUNTS
    : active !== 0 && votesSnap.scenario === active
      ? votesSnap.counts
      : EMPTY_COUNTS;

  const scenario = active === 0 ? undefined : getScenario(active);
  const trustRatio = counts.total > 0 ? counts.trust / counts.total : 0;
  const live = demo || connected;

  // ---------- Presenter actions ----------
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Couldn't save to Firebase");
    } finally {
      setBusy(false);
    }
  }, []);

  const goTo = useCallback(
    (id: ActiveScenario) =>
      demo
        ? setDemoState({ activeScenario: id, revealExplanation: false })
        : run(() => update(ref(db, PATHS.state), { activeScenario: id, revealExplanation: false })),
    [run, demo]
  );

  const toggleReveal = useCallback(
    () =>
      demo
        ? setDemoState((s) => ({ ...s, revealExplanation: !s.revealExplanation }))
        : run(() => update(ref(db, PATHS.state), { revealExplanation: !state.revealExplanation })),
    [run, demo, state.revealExplanation]
  );

  const resetAll = useCallback(() => {
    setConfirmReset(false);
    if (demo) {
      setDemoVotes({});
      setDemoState(DEFAULT_STATE);
      return;
    }
    run(async () => {
      await remove(ref(db, PATHS.votes));
      await set(ref(db, PATHS.state), DEFAULT_STATE);
    });
  }, [run, demo]);

  useEffect(() => {
    if (!confirmReset) return;
    const t = setTimeout(() => setConfirmReset(false), 4000);
    return () => clearTimeout(t);
  }, [confirmReset]);

  // Keyboard: 0–3 scenarios, R reveal, Q QR code, Esc close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") setShowQr(false);
      else if (["0", "1", "2", "3"].includes(e.key)) goTo(Number(e.key) as ActiveScenario);
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

  const ctrl = "rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-40 xl:px-4 xl:py-2 xl:text-sm";
  const ctrlIdle = "text-slate-300 hover:bg-white/10 hover:text-white";
  const ctrlOn = "bg-white text-night";

  return (
    <main className="relative flex h-dvh w-full flex-col overflow-hidden bg-night text-slate-100">
      {(demo || !firebaseConfigured) && (
        <p className="border-b border-white/10 py-2 text-center text-sm text-slate-400">
          {demo
            ? "Mode démo : les votes sont simulés. Touches 1 à 3 pour les scénarios, R pour révéler l'analyse."
            : "Firebase n'est pas configuré : l'interface s'affiche mais les votes sont désactivés."}
        </p>
      )}

      <header className="flex items-center justify-between px-[4vw] pt-[3vh]">
        <p className="text-[clamp(1rem,min(2.4vh,1.6vw),1.5rem)] font-semibold tracking-tight">The Trust Pulse</p>
        <p className="flex items-center gap-2 text-[clamp(0.85rem,min(1.8vh,1.2vw),1.125rem)] text-slate-400">
          <span className={`size-2.5 rounded-full ${live ? "bg-secure" : "bg-alarm"}`} aria-hidden />
          {demo ? "Demo" : live ? "Live" : "Offline"}
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-0 min-w-0 flex-[0.8] lg:flex-[1.2]">
          <CyberShield3D
            trustRatio={trustRatio}
            totalVotes={counts.total}
            className="absolute inset-0 [mask-image:radial-gradient(closest-side,black_72%,transparent)]"
          />
        </div>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col justify-center overflow-y-auto px-[5vw] py-[2vh] lg:pr-[4vw] lg:pl-2">
          {!scenario ? (
            <div className="animate-enter">
              <h1 className="font-serif text-[clamp(2.5rem,min(12vh,7vw),8rem)] leading-[0.9] tracking-tight">
                The Art
                <br />
                of the Con
              </h1>
              <p className="mt-[2vh] text-[clamp(1rem,min(3vh,2vw),1.875rem)] text-slate-400">Legacy of Deception</p>

              <div className="mt-[5vh] flex items-center gap-[2vw]">
                {qr && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qr}
                    alt="QR code to join the vote"
                    className="size-[clamp(5.5rem,min(20vh,14vw),12rem)] shrink-0 rounded-2xl bg-white p-[0.6vh] [image-rendering:pixelated]"
                  />
                )}
                <div>
                  <p className="text-[clamp(0.9rem,min(2.3vh,1.5vw),1.5rem)] text-slate-400">Scan to vote, or open</p>
                  <p className="mt-1 text-[clamp(1rem,min(3vh,1.9vw),2rem)] font-semibold tracking-tight [overflow-wrap:anywhere]">{displayUrl(origin)}</p>
                </div>
              </div>
            </div>
          ) : (
            <div key={scenario.id} className="animate-enter flex flex-col">
              <p className="text-[clamp(0.9rem,min(2.3vh,1.5vw),1.5rem)] text-slate-400">Scenario {scenario.id} of 3</p>
              <h1 className="mt-1 text-[clamp(1.4rem,min(4.6vh,3vw),3rem)] leading-tight font-semibold tracking-tight">
                {scenario.title.split(" — ")[1] ?? scenario.title}
              </h1>

              {state.revealExplanation ? (
                <div className="animate-enter mt-[3vh] border-l-2 border-alarm pl-[1.5vw]">
                  <p className="text-[clamp(0.9rem,min(2.3vh,1.5vw),1.5rem)] text-slate-400">The lever</p>
                  <p className="mt-1 text-[clamp(1.1rem,min(3.3vh,2.2vw),2.1rem)] leading-tight font-semibold">{scenario.lever}</p>
                  <p className="mt-[2vh] text-[clamp(0.9rem,min(2.3vh,1.5vw),1.5rem)] text-slate-400">The flaw it exploits</p>
                  <p className="mt-1 text-[clamp(1rem,min(2.8vh,1.9vw),1.75rem)] leading-snug text-slate-200">{scenario.trapExplanation}</p>
                </div>
              ) : (
                <p className="mt-[3vh] max-w-[34ch] font-serif text-[clamp(1.15rem,min(3.7vh,2.5vw),2.4rem)] leading-[1.22] text-slate-200">
                  {scenario.prompt}
                </p>
              )}

              <div className="mt-[4.5vh]">
                <VulnerabilityIndex counts={counts} compact={state.revealExplanation} />
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Presenter controls: faint until hovered or focused */}
      <footer className="flex justify-center px-4 pt-[1vh] pb-[2vh]">
        <div className="flex flex-wrap items-center justify-center gap-1 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-1.5 opacity-30 backdrop-blur transition-opacity duration-300 focus-within:opacity-100 hover:opacity-100">
          <button type="button" onClick={() => setShowQr(true)} className={`${ctrl} ${ctrlIdle}`}>
            QR Code Salle
          </button>
          <span className="mx-1 h-5 w-px bg-white/10" aria-hidden />
          {navButtons.map((b) => (
            <button
              key={b.id}
              type="button"
              disabled={busy}
              onClick={() => goTo(b.id)}
              aria-pressed={active === b.id}
              className={`${ctrl} ${active === b.id ? ctrlOn : ctrlIdle}`}
            >
              {b.label}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-white/10" aria-hidden />
          <button
            type="button"
            disabled={busy || active === 0}
            onClick={toggleReveal}
            aria-pressed={state.revealExplanation}
            className={`${ctrl} ${state.revealExplanation ? ctrlOn : ctrlIdle}`}
          >
            {state.revealExplanation ? "Masquer l'analyse" : "Révéler l'analyse"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => (confirmReset ? resetAll() : setConfirmReset(true))}
            className={`${ctrl} ${confirmReset ? "bg-alarm text-white" : "text-alarm hover:bg-white/10"}`}
          >
            {confirmReset ? "Confirmer le reset" : "Reset Votes"}
          </button>
          {actionError && <span className="px-3 text-sm text-alarm">{actionError}</span>}
        </div>
      </footer>

      {showQr && <QrModal url={origin} qr={qr} onClose={() => setShowQr(false)} />}
    </main>
  );
}
