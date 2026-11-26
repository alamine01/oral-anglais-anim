"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { onValue, ref, set } from "firebase/database";
import { db, firebaseConfigured, PATHS } from "@/lib/firebase";
import {
  DEFAULT_STATE,
  getScenario,
  parseState,
  type PulseState,
  type Vote,
  type VoteChoice,
} from "@/lib/scenarios";

const VOTER_KEY = "trust_pulse_voter_id";

function createVoterId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

let cachedVoterId: string | null = null;

function getOrCreateVoterId(): string {
  if (cachedVoterId) return cachedVoterId;
  cachedVoterId = readOrCreateVoterId();
  return cachedVoterId;
}

function readOrCreateVoterId(): string {
  try {
    const existing = window.localStorage.getItem(VOTER_KEY);
    if (existing && /^[A-Za-z0-9_-]{6,64}$/.test(existing)) return existing;
    const id = createVoterId();
    window.localStorage.setItem(VOTER_KEY, id);
    return id;
  } catch {
    // Private mode / storage disabled: fall back to a per-session id.
    return createVoterId();
  }
}

const noopSubscribe = () => () => {};

function makeVote(choice: VoteChoice): Vote {
  return { choice, timestamp: Date.now() };
}

function LiveIndicator({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest">
      <span className="relative flex h-2.5 w-2.5">
        {connected && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 animate-pulse-ring" />
        )}
        <span
          className={`relative inline-flex h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-400" : "bg-slate-600"}`}
        />
      </span>
      <span className={connected ? "text-emerald-300" : "text-slate-500"}>{connected ? "Live" : "Connecting…"}</span>
    </div>
  );
}

function NotConfiguredBanner() {
  if (firebaseConfigured) return null;
  return (
    <div className="relative z-30 bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-slate-950">
      Firebase n&apos;est pas configuré : l&apos;interface s&apos;affiche mais les votes sont désactivés.
    </div>
  );
}

export default function AudiencePage() {
  // Client-only voter identity (null during server prerender).
  const voterId = useSyncExternalStore(noopSubscribe, getOrCreateVoterId, () => null);
  const [state, setState] = useState<PulseState>(DEFAULT_STATE);
  const [stateLoaded, setStateLoaded] = useState(!firebaseConfigured);
  const [connected, setConnected] = useState(false);
  const [voteSnap, setVoteSnap] = useState<{ key: string; choice: VoteChoice | null }>({ key: "", choice: null });
  const [sending, setSending] = useState<VoteChoice | null>(null);
  const [errorSnap, setErrorSnap] = useState<{ key: string; message: string } | null>(null);

  // Session state + connection status
  useEffect(() => {
    const unsubState = onValue(
      ref(db, PATHS.state),
      (snap) => {
        setState(parseState(snap.val()));
        setStateLoaded(true);
      },
      () => setStateLoaded(true)
    );
    const unsubConn = onValue(ref(db, ".info/connected"), (snap) => setConnected(snap.val() === true));
    return () => {
      unsubState();
      unsubConn();
    };
  }, []);

  // My own vote on the active scenario (survives reloads, clears on reset)
  const active = state.activeScenario;
  const voteKey = `${active}:${voterId ?? ""}`;
  useEffect(() => {
    if (!voterId || active === 0) return;
    const key = `${active}:${voterId}`;
    const unsub = onValue(ref(db, PATHS.voterVote(active, voterId)), (snap) => {
      const v = snap.val() as Partial<Vote> | null;
      setVoteSnap({ key, choice: v?.choice === "trust" || v?.choice === "verify" ? v.choice : null });
    });
    return () => unsub();
  }, [active, voterId]);

  // Values are keyed by scenario so they reset automatically when the presenter switches.
  const myVote = voteSnap.key === voteKey ? voteSnap.choice : null;
  const error = errorSnap?.key === voteKey ? errorSnap.message : null;

  const scenario = active === 0 ? undefined : getScenario(active);

  async function vote(choice: VoteChoice) {
    if (!voterId || !scenario || sending) return;
    if (choice === myVote) return;
    const key = voteKey;
    setSending(choice);
    setErrorSnap(null);
    try {
      await set(ref(db, PATHS.voterVote(scenario.id, voterId)), makeVote(choice));
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(30);
    } catch {
      setErrorSnap({ key, message: "Vote not sent — check your connection and tap again." });
    } finally {
      setSending(null);
    }
  }

  return (
    <main className="relative flex min-h-dvh flex-col bg-slate-950 text-slate-100 overflow-hidden">
      <NotConfiguredBanner />
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(0,240,255,0.10),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.07] bg-[linear-gradient(rgba(0,240,255,0.6)_1px,transparent_1px),linear-gradient(90deg,rgba(0,240,255,0.6)_1px,transparent_1px)] bg-[size:28px_28px]" />

      <header className="relative z-10 flex items-center justify-between px-5 pt-5 pb-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cyan-300/70">The Art of the Con</p>
          <h1 className="text-lg font-bold tracking-tight">
            The Trust <span className="text-cyan-300">Pulse</span>
          </h1>
        </div>
        <LiveIndicator connected={connected} />
      </header>

      <section className="relative z-10 flex flex-1 flex-col px-5 pb-8">
        {!stateLoaded ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-400/20 border-t-cyan-300" />
          </div>
        ) : !scenario ? (
          /* ---------- Waiting screen ---------- */
          <div className="flex flex-1 flex-col items-center justify-center text-center animate-fade-up">
            <div className="relative mb-10 flex h-36 w-36 items-center justify-center">
              <span className="absolute inset-0 rounded-full border border-cyan-300/40 animate-pulse-ring" />
              <span
                className="absolute inset-0 rounded-full border border-cyan-300/30 animate-pulse-ring"
                style={{ animationDelay: "0.9s" }}
              />
              <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-cyan-400/10 ring-1 ring-cyan-300/50 shadow-[0_0_60px_rgba(0,240,255,0.35)]">
                <svg viewBox="0 0 24 24" className="h-11 w-11 text-cyan-300" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" strokeLinejoin="round" />
                  <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
            <h2 className="text-3xl font-black leading-tight">
              The Art of the Con
            </h2>
            <p className="mt-2 font-mono text-xs uppercase tracking-[0.25em] text-slate-400">Legacy of Deception</p>
            <p className="mt-8 max-w-xs text-base text-slate-300">
              Waiting for the presenter to launch <span className="font-semibold text-cyan-300">Scenario 01</span>
              <span className="inline-block w-6 text-left animate-pulse">...</span>
            </p>
            <p className="mt-6 max-w-xs text-sm text-slate-500">
              Keep this page open. Questions will appear here automatically.
            </p>
          </div>
        ) : (
          /* ---------- Active scenario ---------- */
          <div key={scenario.id} className="flex flex-1 flex-col animate-fade-up">
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-cyan-300/80">
              {String(scenario.id).padStart(2, "0")} / 03
            </p>
            <h2 className="mt-1 text-2xl font-extrabold leading-tight">{scenario.title.split(" — ")[1] ?? scenario.title}</h2>

            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-[17px] leading-relaxed text-slate-200 shadow-inner">
              {scenario.prompt}
            </div>

            <div className="mt-6 flex flex-col gap-4">
              <VoteButton
                variant="trust"
                label={scenario.trustLabel}
                selected={myVote === "trust"}
                dimmed={myVote === "verify"}
                loading={sending === "trust"}
                disabled={!voterId || sending !== null}
                onClick={() => vote("trust")}
              />
              <VoteButton
                variant="verify"
                label={scenario.verifyLabel}
                selected={myVote === "verify"}
                dimmed={myVote === "trust"}
                loading={sending === "verify"}
                disabled={!voterId || sending !== null}
                onClick={() => vote("verify")}
              />
            </div>

            <div className="mt-4 min-h-[3rem] text-center text-sm">
              {error ? (
                <p className="text-red-400">{error}</p>
              ) : myVote ? (
                <p className="text-slate-300">
                  <span className="mr-1.5 inline-block rounded-full bg-emerald-400/15 px-2 py-0.5 font-semibold text-emerald-300">
                    ✓ Vote recorded
                  </span>
                  <span className="block mt-1.5 text-slate-500">Changed your mind? Tap the other option.</span>
                </p>
              ) : (
                <p className="text-slate-500">Tap one option — your answer is anonymous.</p>
              )}
            </div>

            {state.revealExplanation && (
              <div className="mt-2 animate-fade-up rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4">
                {myVote && (
                  <p
                    className={`mb-2 text-sm font-bold uppercase tracking-wider ${
                      myVote === "trust" ? "text-red-400" : "text-emerald-300"
                    }`}
                  >
                    {myVote === "trust" ? "⚠ You would have been compromised" : "🛡 You stayed secure"}
                  </p>
                )}
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-300">The trap</p>
                <p className="mt-1 text-[15px] leading-relaxed text-amber-50">{scenario.trapExplanation}</p>
                <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.2em] text-amber-300/80">Lever</p>
                <p className="mt-0.5 text-sm text-amber-100/90">{scenario.lever}</p>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function VoteButton({
  variant,
  label,
  selected,
  dimmed,
  loading,
  disabled,
  onClick,
}: {
  variant: VoteChoice;
  label: string;
  selected: boolean;
  dimmed: boolean;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const isTrust = variant === "trust";
  const base =
    "relative w-full min-h-[92px] rounded-2xl px-5 py-4 text-left text-lg font-bold leading-snug transition-all duration-200 active:scale-[0.98] disabled:cursor-wait focus:outline-none focus-visible:ring-4";
  const palette = isTrust
    ? selected
      ? "bg-gradient-to-br from-red-500 to-amber-500 text-white ring-2 ring-amber-200 shadow-[0_0_40px_rgba(239,68,68,0.55)]"
      : "bg-gradient-to-br from-red-600/25 to-amber-500/20 text-red-50 ring-1 ring-red-400/50 focus-visible:ring-red-400/50"
    : selected
      ? "bg-gradient-to-br from-cyan-400 to-emerald-400 text-slate-950 ring-2 ring-cyan-100 shadow-[0_0_40px_rgba(0,240,255,0.5)]"
      : "bg-gradient-to-br from-cyan-500/20 to-emerald-500/15 text-cyan-50 ring-1 ring-cyan-300/50 focus-visible:ring-cyan-300/50";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`${base} ${palette} ${dimmed ? "opacity-45" : "opacity-100"}`}
    >
      <span className="flex items-center gap-4">
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl ${
            selected ? "bg-black/15" : isTrust ? "bg-red-500/20" : "bg-cyan-400/15"
          }`}
          aria-hidden
        >
          {loading ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : selected ? (
            "✓"
          ) : isTrust ? (
            "⚡"
          ) : (
            "🔍"
          )}
        </span>
        <span>{label}</span>
      </span>
    </button>
  );
}
