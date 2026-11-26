import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getDatabase, type Database } from "firebase/database";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

/** False until the NEXT_PUBLIC_FIREBASE_* variables are provided at build time. */
export const firebaseConfigured = Boolean(firebaseConfig.databaseURL);

if (!firebaseConfigured) {
  console.warn(
    "[Trust Pulse] NEXT_PUBLIC_FIREBASE_DATABASE_URL is missing — the UI renders but votes are disabled. Copy .env.local.example to .env.local and fill in your Firebase project values."
  );
  // Placeholder so the SDK initialises; it simply never connects.
  firebaseConfig.databaseURL = "https://trust-pulse-unconfigured-default-rtdb.firebaseio.com";
}

// Reuse the existing app during hot reload / multiple imports.
const app: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db: Database = getDatabase(app);

// Shared database paths
export const PATHS = {
  state: "trust_pulse/state",
  votes: "trust_pulse/votes",
  scenarioVotes: (scenarioId: number) => `trust_pulse/votes/${scenarioId}`,
  voterVote: (scenarioId: number, voterId: string) => `trust_pulse/votes/${scenarioId}/${voterId}`,
} as const;
