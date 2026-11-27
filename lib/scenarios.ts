export const OPTION_IDS = ["a", "b", "c", "d"] as const;
export type OptionId = (typeof OPTION_IDS)[number];

/** 0 = waiting screen, 1..N = scenario id. */
export type ActiveScenario = number;

export interface AnswerOption {
  id: OptionId;
  label: string;
  /** Exactly one option per scenario is safe; the others are plausible traps. */
  safe: boolean;
}

export interface Scenario {
  id: number;
  title: string;
  prompt: string;
  options: AnswerOption[];
  trapExplanation: string;
  lever: string;
}

export interface PulseState {
  activeScenario: ActiveScenario;
  revealExplanation: boolean;
}

export interface Vote {
  choice: OptionId;
  timestamp: number;
}

export interface Tally {
  /** Votes on a trap option. */
  compromised: number;
  /** Votes on the safe option. */
  secure: number;
  total: number;
  perOption: Record<OptionId, number>;
}

export const DEFAULT_STATE: PulseState = {
  activeScenario: 0,
  revealExplanation: false,
};

export const SCENARIOS: Scenario[] = [
  {
    id: 1,
    title: "Scenario 01 — The Urgent Admin Email",
    prompt:
      "You receive an email from support@umontpellier-scolarite.fr: 'Your final semester grade is missing due to a sync error. Log in within 15 minutes to validate.' What do you do?",
    options: [
      {
        id: "a",
        label: "Hover over the link first: it shows umontpellier.fr, so log in",
        safe: false,
      },
      {
        id: "b",
        label: "Reply to the email and ask them to confirm it's genuine",
        safe: false,
      },
      {
        id: "c",
        label:
          "Ignore the link and open the ENT yourself from your usual bookmark",
        safe: true,
      },
      {
        id: "d",
        label: "Log in, then change your password straight away just in case",
        safe: false,
      },
    ],
    trapExplanation:
      "Typosquatting domain (umontpellier-scolarite.fr instead of umontpellier.fr) + artificial 15-minute countdown designed to bypass critical thinking. A link that looks right proves nothing, a reply goes straight to the attacker, and a stolen session is used within seconds. Only a route you open yourself is safe.",
    lever: "Authority & Urgency (Victor Lustig / Classic Spear-Phishing)",
  },
  {
    id: 2,
    title: "Scenario 02 — The Leaked Exam QR Code",
    prompt:
      "A classmate shares a QR code in the promo group chat: 'Leaked exam topics for Monday's evaluation — link expires in 5 minutes.' What do you do?",
    options: [
      {
        id: "a",
        label:
          "Scan it, but only log in if the page really looks like the university's",
        safe: false,
      },
      {
        id: "b",
        label:
          "Don't scan it, and ask the classmate directly outside the group chat",
        safe: true,
      },
      {
        id: "c",
        label:
          "Scan it with your phone rather than your laptop, to limit the risk",
        safe: false,
      },
      {
        id: "d",
        label: "Wait until others in the chat say it worked, then scan it",
        safe: false,
      },
    ],
    trapExplanation:
      "Exploits peer trust (social proof) and FOMO (fear of missing out). QR codes bypass email spam filters and lead directly to credential-harvesting pages, which are pixel-perfect copies. Phones are the main target, and the 'it worked for me' messages can come from already-hijacked accounts.",
    lever: "Social Proof & Scarcity (Elizabeth Holmes / Quishing)",
  },
  {
    id: 3,
    title: "Scenario 03 — The Live Video Call",
    prompt:
      "Your manager calls you on Teams with live video and voice: 'I'm in a board meeting, transfer €2,500 to this supplier right now, I'll sign the form later.' What do you do?",
    options: [
      {
        id: "a",
        label:
          "Ask a personal question that only your real manager could answer",
        safe: false,
      },
      {
        id: "b",
        label:
          "Ask them to turn their head and wave, to check it isn't a deepfake",
        safe: false,
      },
      {
        id: "c",
        label:
          "Make the transfer, then email your manager to confirm it afterwards",
        safe: false,
      },
      {
        id: "d",
        label: "Hang up and call back on their official phone number",
        safe: true,
      },
    ],
    trapExplanation:
      "Real-time AI voice & face cloning (similar to the $25M Hong Kong Arup heist). Attackers research their targets on social media, live deepfakes now handle movement, and a confirmation sent after the transfer is too late. Only out-of-band verification defeats real-time deepfakes.",
    lever: "Halo Effect & AI Deepfake (Hong Kong $25M Heist)",
  },
  {
    id: 4,
    title: "Scenario 04 — The Helpdesk Call",
    prompt:
      "Someone calls: 'Hi, IT helpdesk here. We're migrating student accounts tonight and yours is flagged. I'm sending you a code by SMS, just read it back to me so you don't lose your files.' What do you do?",
    options: [
      {
        id: "a",
        label: "Read the code: they already know your name and student number",
        safe: false,
      },
      {
        id: "b",
        label: "Ask for their full name and staff ID before reading the code",
        safe: false,
      },
      {
        id: "c",
        label:
          "Never share the code, hang up and contact IT through the official website",
        safe: true,
      },
      {
        id: "d",
        label:
          "Read only the first half of the code to test whether they're real",
        safe: false,
      },
    ],
    trapExplanation:
      "A verification code is a key, not an identity check: whoever reads it gets in. Your name and student number leak everywhere, fake names and staff IDs cost nothing to invent, and half a code is often enough to guess the rest. Kevin Mitnick broke into major companies mostly by phone, simply by sounding like a helpful colleague.",
    lever: "Pretexting & Helpfulness (Kevin Mitnick)",
  },
  {
    id: 5,
    title: "Scenario 05 — The 1 a.m. Notification Storm",
    prompt:
      "At 1 a.m. your phone keeps buzzing: 'Approve sign-in?', fifteen times. Then a WhatsApp message: 'IT security here, we're fixing a bug. Approve the next request and it will stop.' What do you do?",
    options: [
      {
        id: "a",
        label: "Deny every request, change your password and report it to IT",
        safe: true,
      },
      {
        id: "b",
        label:
          "Approve once so it stops, then change your password right after",
        safe: false,
      },
      {
        id: "c",
        label: "Reply on WhatsApp and ask them to prove they work in IT",
        safe: false,
      },
      {
        id: "d",
        label: "Mute notifications and deal with it calmly in the morning",
        safe: false,
      },
    ],
    trapExplanation:
      "A flood of sign-in requests means someone already has your password. One tired 'Approve' gives them full access in seconds, which is exactly how Uber was breached in 2022. Real IT never asks you to approve a request you didn't start, and waiting until morning leaves the stolen password working all night.",
    lever: "Fatigue & Authority (Uber 2022 MFA Bombing)",
  },
  {
    id: 6,
    title: "Scenario 06 — The Lost USB Key",
    prompt:
      "In the library you find a USB key labelled 'Exam grades — CONFIDENTIAL'. Nobody is around. What do you do?",
    options: [
      {
        id: "a",
        label: "Plug it into a library computer rather than yours, to be safe",
        safe: false,
      },
      {
        id: "b",
        label: "Open it only to find the owner's name and give it back",
        safe: false,
      },
      {
        id: "c",
        label: "Scan it with your antivirus first, then open it",
        safe: false,
      },
      {
        id: "d",
        label: "Don't plug it in anywhere and hand it to the library desk",
        safe: true,
      },
    ],
    trapExplanation:
      "In a University of Illinois experiment, nearly half of the USB keys dropped on campus were plugged in, often 'to find the owner'. A malicious key can pose as a keyboard and type commands within seconds, before any antivirus scan, on any computer, including a shared one on the university network.",
    lever: "Curiosity & Baiting (Illinois USB Drop Study)",
  },
];

export const SCENARIO_COUNT = SCENARIOS.length;

export function getScenario(id: number): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export function isOptionId(v: unknown): v is OptionId {
  return typeof v === "string" && (OPTION_IDS as readonly string[]).includes(v);
}

export function optionLetter(id: OptionId): string {
  return id.toUpperCase();
}

/** Normalises any raw value coming from the database into a safe PulseState. */
export function parseState(raw: unknown): PulseState {
  if (!raw || typeof raw !== "object") return DEFAULT_STATE;
  const r = raw as Partial<PulseState>;
  const a = Number(r.activeScenario);
  const activeScenario =
    Number.isInteger(a) && a >= 1 && a <= SCENARIO_COUNT ? a : 0;
  return { activeScenario, revealExplanation: Boolean(r.revealExplanation) };
}

export function emptyTally(): Tally {
  return {
    compromised: 0,
    secure: 0,
    total: 0,
    perOption: { a: 0, b: 0, c: 0, d: 0 },
  };
}

/** Counts votes from a raw `votes/{scenarioId}` snapshot value. */
export function tallyVotes(
  raw: unknown,
  scenario: Scenario | undefined,
): Tally {
  const t = emptyTally();
  if (!scenario || !raw || typeof raw !== "object") return t;
  const safeId = scenario.options.find((o) => o.safe)?.id;
  for (const v of Object.values(raw as Record<string, Partial<Vote>>)) {
    if (!isOptionId(v?.choice)) continue;
    t.perOption[v.choice]++;
    t.total++;
    if (v.choice === safeId) t.secure++;
    else t.compromised++;
  }
  return t;
}

/** Adds one vote to a tally (used by the demo simulator). */
export function addVote(t: Tally, choice: OptionId, scenario: Scenario): Tally {
  const safe = scenario.options.find((o) => o.id === choice)?.safe ?? false;
  return {
    compromised: t.compromised + (safe ? 0 : 1),
    secure: t.secure + (safe ? 1 : 0),
    total: t.total + 1,
    perOption: { ...t.perOption, [choice]: t.perOption[choice] + 1 },
  };
}
