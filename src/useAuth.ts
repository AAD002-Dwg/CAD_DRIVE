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
}

const provider = new GoogleAuthProvider();
// Solo autenticación de identidad para la app (no pide scopes sensibles)
provider.setCustomParameters({ prompt: 'select_account' });

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Escuchar cambios de autenticación (persiste entre recargas)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: User | null) => {
      if (firebaseUser) {
        setUser({
          uid: firebaseUser.uid,
          displayName: firebaseUser.displayName || firebaseUser.email || 'Usuario',
          email: firebaseUser.email || '',
          photoURL: firebaseUser.photoURL,
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithPopup(auth, provider);
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
