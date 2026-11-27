"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { onValue, ref, set } from "firebase/database";
import { db, firebaseConfigured, PATHS } from "@/lib/firebase";
import {
  DEFAULT_STATE,
  getScenario,
  isOptionId,
  optionLetter,
  parseState,
  SCENARIO_COUNT,
  type OptionId,
  type PulseState,
  type Vote,
} from "@/lib/scenarios";

const VOTER_KEY = "trust_pulse_voter_id";
const noopSubscribe = () => () => {};

function createVoterId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

let cachedVoterId: string | null = null;

/** Stable per-device id stored in localStorage (one vote per scenario, editable). */
function getOrCreateVoterId(): string {
  if (cachedVoterId) return cachedVoterId;
  try {
    const existing = window.localStorage.getItem(VOTER_KEY);
    if (existing && /^[A-Za-z0-9_-]{6,64}$/.test(existing)) {
      cachedVoterId = existing;
    } else {
      cachedVoterId = createVoterId();
      window.localStorage.setItem(VOTER_KEY, cachedVoterId);
    }
  } catch {
    // Private mode / storage disabled: fall back to a per-session id.
    cachedVoterId = createVoterId();
  }
  return cachedVoterId;
}

function makeVote(choice: OptionId): Vote {
  return { choice, timestamp: Date.now() };
}

/** Demo mode: /?demo=2&reveal shows scenario 2 locally, without Firebase. */
function readDemo(): string {
  const q = new URLSearchParams(window.location.search);
  return q.has("demo")
    ? `${q.get("demo") || "1"}|${q.has("reveal") ? 1 : 0}`
    : "";
}

function Notice({ demo }: { demo: boolean }) {
  if (!demo && firebaseConfigured) return null;
  return (
    <p className="border-b border-white/10 px-6 py-2.5 text-center text-[13px] text-slate-400">
      {demo
        ? "Mode démo : ton vote reste sur ce téléphone."
        : "Firebase n'est pas configuré : les votes sont désactivés."}
    </p>
  );
}

export default function AudiencePage() {
  const demoKey = useSyncExternalStore(noopSubscribe, readDemo, () => "");
  const demo = demoKey !== "";
  const voterId = useSyncExternalStore(
    noopSubscribe,
    getOrCreateVoterId,
    () => null,
  );

  const [liveState, setLiveState] = useState<PulseState>(DEFAULT_STATE);
  const [liveLoaded, setLiveLoaded] = useState(!firebaseConfigured);
  const [connected, setConnected] = useState(false);
  const [voteSnap, setVoteSnap] = useState<{
    key: string;
    choice: OptionId | null;
  }>({ key: "", choice: null });
  const [demoVote, setDemoVote] = useState<OptionId | null>(null);
  const [sending, setSending] = useState<OptionId | null>(null);
  const [errorSnap, setErrorSnap] = useState<{
    key: string;
    message: string;
  } | null>(null);

  const state: PulseState = demo
    ? parseState({
        activeScenario: Number(demoKey.split("|")[0]),
        revealExplanation: demoKey.endsWith("|1"),
      })
    : liveState;
  const loaded = demo || liveLoaded;

  // Session state + connection status
  useEffect(() => {
    if (demo) return;
    const unsubState = onValue(
      ref(db, PATHS.state),
      (snap) => {
        setLiveState(parseState(snap.val()));
        setLiveLoaded(true);
      },
      () => setLiveLoaded(true),
    );
    const unsubConn = onValue(ref(db, ".info/connected"), (snap) =>
      setConnected(snap.val() === true),
    );
    return () => {
      unsubState();
      unsubConn();
    };
  }, [demo]);

  // My own vote on the active scenario (survives reloads, clears on reset)
  const active = state.activeScenario;
  const voteKey = `${active}:${voterId ?? ""}`;
  useEffect(() => {
    if (demo || !voterId || active === 0) return;
    const key = `${active}:${voterId}`;
    const unsub = onValue(ref(db, PATHS.voterVote(active, voterId)), (snap) => {
      const v = snap.val() as Partial<Vote> | null;
      setVoteSnap({ key, choice: isOptionId(v?.choice) ? v.choice : null });
    });
    return () => unsub();
  }, [active, voterId, demo]);

  // Keyed by scenario, so they reset on their own when the presenter moves on.
  const myVote = demo
    ? demoVote
    : voteSnap.key === voteKey
      ? voteSnap.choice
      : null;
  const error = errorSnap?.key === voteKey ? errorSnap.message : null;
  const scenario = active === 0 ? undefined : getScenario(active);
  const myVoteSafe = myVote
    ? (scenario?.options.find((o) => o.id === myVote)?.safe ?? null)
    : null;
  const live = demo || connected;

  async function vote(choice: OptionId) {
    if (
      !voterId ||
      !scenario ||
      sending ||
      choice === myVote ||
      state.revealExplanation
    )
      return;
    if (demo) {
      setDemoVote(choice);
      return;
    }
    const key = voteKey;
    setSending(choice);
    setErrorSnap(null);
    try {
      await set(
        ref(db, PATHS.voterVote(scenario.id, voterId)),
        makeVote(choice),
      );
      navigator.vibrate?.(20);
    } catch {
      setErrorSnap({
        key,
        message:
          "Your vote didn't go through. Check your connection and tap again.",
      });
    } finally {
      setSending(null);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col bg-slate-950 text-slate-100">
      <Notice demo={demo} />

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pt-6 pb-8">
        <header className="flex items-center justify-between text-[15px]">
          <span className="font-semibold tracking-tight">The Trust Pulse</span>
          <span
            className="flex items-center gap-2 text-slate-400"
            aria-live="polite"
          >
            <span
              className={`size-2 rounded-full transition-colors ${live ? "bg-secure" : "bg-slate-600"}`}
              aria-hidden
            />
            {live ? "Connected" : "Connecting"}
          </span>
        </header>

        {!loaded ? (
          <div
            className="flex flex-1 items-center justify-center"
            aria-label="Loading"
          >
            <span className="size-6 animate-spin rounded-full border-2 border-white/15 border-t-white/70" />
          </div>
        ) : !scenario ? (
          <section className="flex flex-1 flex-col justify-center">
            <h1 className="font-serif text-[3.5rem] leading-[0.95] tracking-tight">
              The Art
              <br />
              of the Con
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-slate-300">
              Waiting for the presenter to launch Scenario 01...
            </p>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-500">
              Keep this page open. The first question will appear here on its
              own.
            </p>
          </section>
        ) : (
          <section
            key={scenario.id}
            className="animate-enter flex flex-1 flex-col pt-8"
          >
            <p className="text-[15px] text-slate-400">
              Scenario {scenario.id} of {SCENARIO_COUNT}
            </p>
            <h1 className="mt-1 text-[1.75rem] leading-tight font-semibold tracking-tight">
              {scenario.title.split(" — ")[1] ?? scenario.title}
            </h1>

            <p className="mt-5 font-serif text-[1.3rem] leading-[1.35] text-slate-200">
              {scenario.prompt}
            </p>

            <div className="mt-auto space-y-2.5 pt-8">
              {scenario.options.map((o) => (
                <Choice
                  key={o.id}
                  letter={optionLetter(o.id)}
                  label={o.label}
                  selected={myVote === o.id}
                  faded={myVote !== null && myVote !== o.id}
                  busy={sending === o.id}
                  revealed={state.revealExplanation}
                  isTrap={!o.safe}
                  disabled={
                    !voterId || sending !== null || state.revealExplanation
                  }
                  onClick={() => vote(o.id)}
                />
              ))}
            </div>

            <p
              className={`mt-4 text-center text-[14px] ${error ? "text-alarm" : "text-slate-500"}`}
              aria-live="polite"
            >
              {error ??
                (state.revealExplanation
                  ? "Voting is closed for this scenario."
                  : myVote
                    ? "Vote recorded. Tap another answer to change it."
                    : "Your answer is anonymous.")}
            </p>

            {state.revealExplanation && (
              <div className="animate-enter mt-8 border-t border-white/10 pt-6">
                <h2
                  className={`text-xl font-semibold ${
                    myVoteSafe === false
                      ? "text-alarm"
                      : myVoteSafe
                        ? "text-secure"
                        : "text-slate-100"
                  }`}
                >
                  {myVoteSafe === false
                    ? "You would have been conned."
                    : myVoteSafe
                      ? "You saw through it."
                      : "Here's how the trap works."}
                </h2>
                <p className="mt-3 text-[16px] leading-relaxed text-slate-300">
                  {scenario.trapExplanation}
                </p>
                <p className="mt-4 text-[14px] leading-relaxed text-slate-500">
                  Lever: {scenario.lever}
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function Choice({
  letter,
  label,
  selected,
  faded,
  busy,
  revealed,
  isTrap,
  disabled,
  onClick,
}: {
  letter: string;
  label: string;
  selected: boolean;
  faded: boolean;
  busy: boolean;
  revealed: boolean;
  isTrap: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  // Neutral while voting, so colour gives nothing away; true colours on reveal.
  let look: string;
  if (!revealed) {
    look = selected
      ? "border-transparent bg-white text-slate-950"
      : "border-white/12 bg-white/[0.03] text-slate-100 active:bg-white/[0.07]";
  } else if (isTrap) {
    look = selected
      ? "border-transparent bg-alarm text-white"
      : "border-alarm/60 bg-transparent text-slate-200";
  } else {
    look = selected
      ? "border-transparent bg-secure text-[#03161c]"
      : "border-secure/60 bg-transparent text-slate-200";
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`flex min-h-[64px] w-full items-center gap-4 rounded-2xl border px-4 py-3.5 text-left text-[16px] leading-snug font-medium transition-[background-color,border-color,color,opacity,transform] duration-300 active:scale-[0.99] disabled:active:scale-100 ${
        busy ? "cursor-wait" : revealed ? "cursor-default" : ""
      } ${look} ${faded && !revealed ? "opacity-45" : ""}`}
    >
      <span
        aria-hidden
        className={`flex size-8 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold ${
          selected ? "bg-black/10" : "bg-white/[0.06] text-slate-400"
        } ${busy ? "animate-pulse" : ""}`}
      >
        {letter}
      </span>
      <span className="flex-1">{label}</span>
      {revealed && (
        <span
          className={`shrink-0 text-[13px] font-semibold ${selected ? "" : isTrap ? "text-alarm" : "text-secure"}`}
        >
          {isTrap ? "Trap" : "Safe"}
        </span>
      )}
    </button>
  );
}
