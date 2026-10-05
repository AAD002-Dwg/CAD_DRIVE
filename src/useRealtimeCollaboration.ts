/**
 * useRealtimeCollaboration.ts
 * Colaboración en tiempo real entre dispositivos usando Firebase Realtime Database.
 * Reemplaza el BroadcastChannel (que solo funcionaba en el mismo navegador).
 *
 * Arquitectura:
 * /rooms/{roomId}/presence/{userId}  → presencia de usuarios activos
 * /rooms/{roomId}/cursors/{userId}   → posición del cursor en coordenadas WCS
 * /rooms/{roomId}/pins/{pinId}       → marcadores compartidos (fotos y comentarios)
 *
 * Seguridad:
 * - Las reglas de Firebase Database deben requerir auth != null
 * - Los datos de presencia se limpian automáticamente con onDisconnect()
 * - Los cursores usan throttling (máx. 1 update cada 80ms) para no saturar
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ref,
  set,
  onValue,
  remove,
  onDisconnect,
  serverTimestamp,
  off,
  type DatabaseReference,
} from 'firebase/database';
import { database } from './firebase';
import type { AuthUser } from './useAuth';
import type { CadPin } from './App';

export interface PeerUser {
  userId: string;
  displayName: string;
  email: string;
  photoURL: string | null;
  color: string;
  cursor?: { worldX: number; worldY: number };
  lastActive: number;
}

const USER_COLORS = [
  '#ec4899', '#8b5cf6', '#06b6d4', '#10b981',
  '#f59e0b', '#3b82f6', '#f43f5e', '#14b8a6'
];

function getUserColor(uid: string): string {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = (hash << 5) - hash + uid.charCodeAt(i);
    hash |= 0;
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

interface UseRealtimeCollaborationOptions {
  roomId: string | null;
  currentUser: AuthUser | null;
  onPinAdded?: (pin: CadPin) => void;
  onPinDeleted?: (pinId: string) => void;
  onToast?: (msg: string) => void;
}

export function useRealtimeCollaboration({
  roomId,
  currentUser,
  onPinAdded,
  onPinDeleted,
  onToast,
}: UseRealtimeCollaborationOptions) {
  const [peers, setPeers] = useState<PeerUser[]>([]);
  const [peerCursors, setPeerCursors] = useState<Map<string, { worldX: number; worldY: number }>>(new Map());
  const [isConnected, setIsConnected] = useState(false);

  // Refs para cleanup
  const presenceRefCleanup = useRef<(() => void) | null>(null);
  const cursorRefCleanup = useRef<(() => void) | null>(null);
  const pinsRefCleanup = useRef<(() => void) | null>(null);
  const myPresenceDbRef = useRef<DatabaseReference | null>(null);
  const myCursorDbRef = useRef<DatabaseReference | null>(null);

  // Throttle cursor updates (80ms = ~12fps, suficiente para cursores colaborativos)
  const lastCursorSent = useRef(0);

  const userColor = currentUser ? getUserColor(currentUser.uid) : '#6366f1';

  useEffect(() => {
    if (!roomId || !currentUser) {
      cleanup();
      return;
    }

    const uid = currentUser.uid;
    const presenceDbRef = ref(database, `rooms/${roomId}/presence/${uid}`);
    const cursorDbRef = ref(database, `rooms/${roomId}/cursors/${uid}`);
    const allPresenceRef = ref(database, `rooms/${roomId}/presence`);
    const allCursorsRef = ref(database, `rooms/${roomId}/cursors`);
    const pinsRef = ref(database, `rooms/${roomId}/pins`);

    myPresenceDbRef.current = presenceDbRef;
    myCursorDbRef.current = cursorDbRef;

    // Escribir presencia propia
    const presenceData = {
      userId: uid,
      displayName: currentUser.displayName,
      email: currentUser.email,
      photoURL: currentUser.photoURL,
      color: userColor,
      joinedAt: serverTimestamp(),
      lastActive: serverTimestamp(),
    };

    set(presenceDbRef, presenceData);

    // Limpiar presencia automáticamente al desconectarse (Firebase onDisconnect hook)
    onDisconnect(presenceDbRef).remove();
    onDisconnect(cursorDbRef).remove();

    setIsConnected(true);

    // Escuchar presencia de todos los usuarios
    const unsubPresence = onValue(allPresenceRef, (snapshot) => {
      const data = snapshot.val() as Record<string, any> | null;
      if (!data) {
        setPeers([]);
        return;
      }
      const peerList = Object.values(data)
        .filter((p: any) => p.userId !== uid) // excluir usuario propio
        .map((p: any) => ({
          userId: p.userId,
          displayName: p.displayName,
          email: p.email,
          photoURL: p.photoURL || null,
          color: p.color || '#6366f1',
          lastActive: p.lastActive || Date.now(),
        })) as PeerUser[];
      setPeers(peerList);
    });

    // Escuchar cursores de peers
    const unsubCursors = onValue(allCursorsRef, (snapshot) => {
      const data = snapshot.val() as Record<string, any> | null;
      if (!data) {
        setPeerCursors(new Map());
        return;
      }
      const cursorMap = new Map<string, { worldX: number; worldY: number }>();
      Object.entries(data).forEach(([peerId, pos]) => {
        if (peerId !== uid && pos) {
          cursorMap.set(peerId, { worldX: pos.x, worldY: pos.y });
        }
      });
      setPeerCursors(cursorMap);
    });

    // Escuchar solo child_added para pins nuevos en tiempo real
    // (evitamos re-cargar todos los pins en cada cambio)
    // Usamos una referencia directa con onChildAdded
    import('firebase/database').then(({ onChildAdded, onChildRemoved }) => {
      const unsubPinAdd = onChildAdded(pinsRef, (snapshot) => {
        const pin = snapshot.val() as CadPin;
        if (pin && pin.author !== currentUser.displayName) {
          onPinAdded?.(pin);
          onToast?.(`📍 ${pin.author} agregó una ${pin.type === 'photo' ? 'foto' : 'nota'} al plano.`);
        }
      });

      const unsubPinRemove = onChildRemoved(pinsRef, (snapshot) => {
        const pinId = snapshot.key;
        if (pinId) {
          onPinDeleted?.(pinId);
        }
      });

      pinsRefCleanup.current = () => {
        unsubPinAdd();
        unsubPinRemove();
        off(pinsRef);
      };
    });

    presenceRefCleanup.current = () => {
      unsubPresence();
      off(allPresenceRef);
    };
    cursorRefCleanup.current = () => {
      unsubCursors();
      off(allCursorsRef);
    };

    return () => cleanup();
  }, [roomId, currentUser?.uid]);

  const cleanup = useCallback(() => {
    // Remover presencia propia de Firebase
    if (myPresenceDbRef.current) {
      remove(myPresenceDbRef.current);
      myPresenceDbRef.current = null;
    }
    if (myCursorDbRef.current) {
      remove(myCursorDbRef.current);
      myCursorDbRef.current = null;
    }

    presenceRefCleanup.current?.();
    cursorRefCleanup.current?.();
    pinsRefCleanup.current?.();

    setPeers([]);
    setPeerCursors(new Map());
    setIsConnected(false);
  }, []);

  // Enviar posición del cursor (throttled)
  const sendCursor = useCallback((worldX: number, worldY: number) => {
    if (!roomId || !currentUser || !myCursorDbRef.current) return;
    const now = Date.now();
    if (now - lastCursorSent.current < 80) return; // max 12fps
    lastCursorSent.current = now;
    set(myCursorDbRef.current, { x: worldX, y: worldY, ts: now });
  }, [roomId, currentUser]);

  // Compartir un pin nuevo
  const broadcastPin = useCallback((pin: CadPin) => {
    if (!roomId || !currentUser) return;
    const pinRef = ref(database, `rooms/${roomId}/pins/${pin.id}`);
    set(pinRef, pin);
  }, [roomId, currentUser]);

  // Eliminar un pin compartido
  const broadcastDeletePin = useCallback((pinId: string) => {
    if (!roomId || !currentUser) return;
    const pinRef = ref(database, `rooms/${roomId}/pins/${pinId}`);
    remove(pinRef);
  }, [roomId, currentUser]);

  return {
    peers,
    peerCursors,
    isConnected,
    userColor,
    sendCursor,
    broadcastPin,
    broadcastDeletePin,
  };
}
