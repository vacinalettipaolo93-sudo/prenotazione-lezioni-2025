import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyD4AHHLRXIwrsuFu9vMFktpenhevFUvngs",
  authDomain: "prenotazione-lezioni2025.firebaseapp.com",
  projectId: "prenotazione-lezioni2025",
  storageBucket: "prenotazione-lezioni2025.firebasestorage.app",
  messagingSenderId: "880357719082",
  appId: "1:880357719082:web:7ee8f62ffab80de6869753",
  measurementId: "G-RM0JG05L0H"
};

// Inizializza Firebase
const app = initializeApp(firebaseConfig);

// Inizializza Analytics in modo sicuro
// getAnalytics può fallire se non supportato dall'ambiente o se bloccato
let analytics = null;
try {
  analytics = getAnalytics(app);
} catch (e) {
  console.warn("Firebase Analytics non inizializzato:", e);
}

export { analytics };

// Inizializza Firestore ed esportalo per l'uso nell'app
export const db = getFirestore(app);