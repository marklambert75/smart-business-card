// === Firebase Bootstrap ===
/* --- Purpose: centralize Firebase initialization and exports --- */
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getStorage } from "firebase/storage";

/* --- Config: read from Vite environment variables ---
   IMPORTANT: Define these in .env.local and in Vercel Project Settings
   VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID,
   VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID
*/
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/* --- Init app and services --- */
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

/* --- Utility: sanity check (helps during local dev) --- */
export function assertFirebaseEnv() {
  const missing = Object.entries(firebaseConfig)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    console.warn(
      "[firebase] Missing env vars:",
      missing.join(", "),
      "→ Did you create .env.local and restart dev server?"
    );
  }
}

// === Dev helper: anonymous sign-in for uploader (call only when needed) ===
/* --- Use case: for local/dev uploads behind ?admin=1 before owner auth exists --- */
export async function devAnonSignIn() {
  try {
    await signInAnonymously(auth);
    console.info("[firebase] Signed in anonymously for dev upload session.");
  } catch (err) {
    console.error("[firebase] Anonymous sign-in failed:", err);
    throw err;
  }
}
