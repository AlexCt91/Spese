// Configurazione del progetto Firebase (non è un segreto: identifica solo il progetto).
export const firebaseConfig = {
  apiKey: "AIzaSyBrg7ohxc3rg2uP4xJVy6bwIWeYq2x7iyE",
  authDomain: "spese-casa-83c2b.firebaseapp.com",
  projectId: "spese-casa-83c2b",
  storageBucket: "spese-casa-83c2b.firebasestorage.app",
  messagingSenderId: "740653620760",
  appId: "1:740653620760:web:d38d4d011bcdfb4855ed6d"
};

// Gli account autorizzati NON sono qui (il codice è pubblico): stanno solo nelle
// regole di sicurezza di Firestore (firestore.rules), che sono private.

// Modelli Gemini da provare in ordine (se il primo non è disponibile si passa al successivo).
export const AI_MODELS = [
  "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"
];

export const DEFAULT_PERSONAL_CATEGORIES = [
  "Spesa alimentare", "Ristoranti e bar", "Carburante e trasporti",
  "Shopping e abbigliamento", "Salute e farmacia", "Abbonamenti",
  "Svago e tempo libero", "Regali", "Viaggi", "Animali", "Altro"
];

export const DEFAULT_SHARED_CATEGORIES = [
  "Mutuo", "Bollette", "Internet e telefono", "Assicurazioni", "Condominio",
  "Tasse sulla casa", "Spesa per la casa", "Manutenzione e arredamento", "Altro"
];
