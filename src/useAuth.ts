/**
 * useAuth.ts
 * Hook de autenticación con Google Sign-In mediante Firebase Auth.
 * Reemplaza el formulario de nombre libre por identidad OAuth verificada (email + nombre real).
 *
 * Seguridad:
 * - El token de Google está firmado por los servidores de Google
 * - El UID es único e inmutable por usuario
 * - El email es verificado por Google (no puede suplantarse)
 * - El Access Token para Drive sigue siendo el mismo flujo que ya tenías
 */
import { useState, useEffect, useCallback } from 'react';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User
} from 'firebase/auth';
import { auth } from './firebase';

export interface AuthUser {
  uid: string;           // UID único de Firebase (inmutable)
  displayName: string;   // Nombre real de Google
  email: string;         // Email verificado por Google
  photoURL: string | null;
  accessToken: string | null; // Token OAuth para Google Drive (si se otorgó)
}

const provider = new GoogleAuthProvider();
// Solicitar scope de Drive además del login básico
provider.addScope('https://www.googleapis.com/auth/drive.file');
provider.addScope('https://www.googleapis.com/auth/drive.readonly');
// Para forzar selección de cuenta siempre (evita auto-login silencioso)
provider.setCustomParameters({ prompt: 'select_account' });

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Escuchar cambios de autenticación (persiste entre recargas)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: User | null) => {
      if (firebaseUser) {
        // Obtener Access Token de Google para las APIs de Drive
        let accessToken: string | null = null;
        try {
          // getIdToken refresca el token si está expirado
          await (firebaseUser as any).getIdTokenResult();
          // El access token de Google Drive viene del provider
          // Lo guardamos en sessionStorage para Drive API (se limpia al cerrar el navegador)
          accessToken = sessionStorage.getItem('gd_access_token');
        } catch {
          accessToken = null;
        }

        setUser({
          uid: firebaseUser.uid,
          displayName: firebaseUser.displayName || firebaseUser.email || 'Usuario',
          email: firebaseUser.email || '',
          photoURL: firebaseUser.photoURL,
          accessToken,
        });
      } else {
        setUser(null);
        sessionStorage.removeItem('gd_access_token');
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await signInWithPopup(auth, provider);
      // Extraer el Access Token de Google para Drive API
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        // Guardamos en sessionStorage: se limpia al cerrar el browser (más seguro que localStorage)
        sessionStorage.setItem('gd_access_token', credential.accessToken);
        // Actualizar el usuario con el access token
        setUser(prev => prev ? { ...prev, accessToken: credential.accessToken! } : null);
      }
    } catch (err: any) {
      // Códigos de error comunes de Firebase Auth
      if (err.code === 'auth/popup-closed-by-user') {
        setError('Inicio de sesión cancelado.');
      } else if (err.code === 'auth/popup-blocked') {
        setError('El popup fue bloqueado por el navegador. Permitir popups para este sitio.');
      } else if (err.code === 'auth/network-request-failed') {
        setError('Error de red. Verificá tu conexión a internet.');
      } else {
        setError('Error al iniciar sesión: ' + (err.message || 'Error desconocido'));
      }
      console.error('[useAuth] Error en signInWithGoogle:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOutUser = useCallback(async () => {
    try {
      await signOut(auth);
      sessionStorage.removeItem('gd_access_token');
    } catch (err) {
      console.error('[useAuth] Error al cerrar sesión:', err);
    }
  }, []);

  return {
    user,
    loading,
    error,
    isAuthenticated: !!user,
    signInWithGoogle,
    signOutUser,
  };
}
