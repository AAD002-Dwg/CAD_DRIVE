/**
 * firebase.ts
 * Inicialización de Firebase para autenticación y colaboración en tiempo real.
 * Las credenciales vienen de variables de entorno (.env) — NUNCA hardcodear aquí.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getDatabase, type Database } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Validar que las variables de entorno estén presentes
const missingVars = Object.entries(firebaseConfig)
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missingVars.length > 0) {
  console.warn(
    `[Firebase] Las siguientes variables de entorno no están configuradas: ${missingVars.join(', ')}.\n` +
    'Copiá .env.example a .env y completá las credenciales de Firebase.'
  );
}

let app: FirebaseApp;
let auth: Auth;
let database: Database;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  database = getDatabase(app);
} catch (e) {
  console.error('[Firebase] Error al inicializar:', e);
  // Fallback: la app funcionará sin colaboración en tiempo real
  throw e;
}

export { app, auth, database };
