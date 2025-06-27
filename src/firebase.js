
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCpKln3maCKW1MQLWhOp_hgqfqZQhQcrqs",
  authDomain: "my-portal-d05fd.firebaseapp.com",
  projectId: "my-portal-d05fd",
  storageBucket: "my-portal-d05fd.firebasestorage.app",
  messagingSenderId: "82448283366",
  appId: "1:82448283366:web:4775ad22c0b8165e796d27",
  measurementId: "G-TECM1R4GKC"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
