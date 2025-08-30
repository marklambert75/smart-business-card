// === Firebase Bootstrap ===
/* --- Purpose: centralize Firebase initialization and exports --- */
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
// import { getAuth } from "firebase/auth"; // (we'll enable owner auth later)
// import { getStorage } from "firebase/storage"; // (not needed for now)

/* --- Config: read from Vite environment variables --- */
// IMPORTANT: Define these in .env.local and Vercel project settings
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Quick env presence check (safe: only booleans)
console.log("[env check]", Object.fromEntries(Object.entries(firebaseConfig).map(([k,v]) => [k, !!v])));


/* --- Init app and services --- */
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
// export const auth = getAuth(app);
// export const storage = getStorage(app);

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
