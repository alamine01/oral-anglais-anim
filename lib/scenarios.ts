export type ScenarioId = 1 | 2 | 3;
export type ActiveScenario = 0 | ScenarioId;
export type VoteChoice = "trust" | "verify";

export interface Scenario {
  id: ScenarioId;
  title: string;
  prompt: string;
  trustLabel: string;
  verifyLabel: string;
  trapExplanation: string;
  lever: string;
}

export interface PulseState {
  activeScenario: ActiveScenario;
  revealExplanation: boolean;
}

export interface Vote {
  choice: VoteChoice;
  timestamp: number;
}

export const DEFAULT_STATE: PulseState = { activeScenario: 0, revealExplanation: false };

export const SCENARIOS: Scenario[] = [
  {
    id: 1,
    title: "Scenario 01 — The Urgent Admin Email",
    prompt:
      "You receive an email from support@umontpellier-scolarite.fr: 'Your final semester grade is missing due to a sync error. Log in within 15 minutes to validate.' What do you do?",
    trustLabel: "Click & log in immediately",
    verifyLabel: "Inspect sender domain & verify via official ENT",
    trapExplanation:
      "Typosquatting domain (umontpellier-scolarite.fr instead of umontpellier.fr) + artificial 15-minute countdown designed to bypass critical thinking.",
    lever: "Authority & Urgency (Victor Lustig / Classic Spear-Phishing)",
  },
  {
    id: 2,
    title: "Scenario 02 — The Leaked Exam QR Code",
    prompt:
      "A classmate shares a QR code in the promo group chat: 'Leaked exam topics for Monday's evaluation — link expires in 5 minutes.' What do you do?",
    trustLabel: "Scan the QR code right away",
    verifyLabel: "Ignore & treat as a Quishing / malware trap",
    trapExplanation:
      "Exploits peer trust (social proof) and FOMO (fear of missing out). QR codes bypass email spam filters and lead directly to credential-harvesting pages.",
    lever: "Social Proof & Scarcity (Elizabeth Holmes / Quishing)",
  },
  {
    id: 3,
    title: "Scenario 03 — The Live Video Call",
    prompt:
      "Your manager calls you on Teams with live video and voice: 'I'm in a board meeting, transfer €2,500 to this supplier right now, I'll sign the form later.' What do you do?",
    trustLabel: "Execute the transfer to help your manager",
    verifyLabel: "Hang up & call back on their official phone number",
    trapExplanation:
      "Real-time AI voice & face cloning (similar to the $25M Hong Kong Arup heist). Only out-of-band verification defeats real-time deepfakes.",
    lever: "Halo Effect & AI Deepfake (Hong Kong $25M Heist)",
  },
];

export function getScenario(id: number): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/** Normalises any raw value coming from the database into a safe PulseState. */
export function parseState(raw: unknown): PulseState {
  if (!raw || typeof raw !== "object") return DEFAULT_STATE;
  const r = raw as Partial<PulseState>;
  const a = Number(r.activeScenario);
  const activeScenario: ActiveScenario = a === 1 || a === 2 || a === 3 ? a : 0;
  return { activeScenario, revealExplanation: Boolean(r.revealExplanation) };
}

/** Counts trust / verify votes from a raw `votes/{scenarioId}` snapshot value. */
export function tallyVotes(raw: unknown): { trust: number; verify: number; total: number } {
  let trust = 0;
  let verify = 0;
  if (raw && typeof raw === "object") {
    for (const v of Object.values(raw as Record<string, Partial<Vote>>)) {
      if (v?.choice === "trust") trust++;
      else if (v?.choice === "verify") verify++;
    }
  }
  return { trust, verify, total: trust + verify };
}
