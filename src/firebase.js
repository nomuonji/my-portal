import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG_JSON);

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// User-owned My Portal data remains in the default Firestore database.
export const db = getFirestore(app);

// Agent Idea Space is isolated in the named Firestore database. It uses the
// same Firebase project and Google login, but no longer shares collections
// such as `ideas` with the user's personal boards.
export const agentDb = getFirestore(app, 'agent-ideas');

// Separate Firestore instance for hobby board (fallback to main db if not configured)
const hobbyConfigJson = process.env.REACT_APP_HOBBY_FIREBASE_CONFIG_JSON;
export const hobbyDb = hobbyConfigJson
  ? getFirestore(initializeApp(JSON.parse(hobbyConfigJson), 'hobby'))
  : db;
