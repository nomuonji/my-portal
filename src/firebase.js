
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG_JSON);

// Main application (ideas, etc.)
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Separate Firestore instance for hobby board (fallback to main db if not configured)
const hobbyConfigJson = process.env.REACT_APP_HOBBY_FIREBASE_CONFIG_JSON;
export const hobbyDb = hobbyConfigJson
  ? getFirestore(initializeApp(JSON.parse(hobbyConfigJson), 'hobby'))
  : db;
