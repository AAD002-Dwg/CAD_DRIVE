import type { UserPresence, RealtimeMessage } from './types';

const USER_COLORS = [
  '#ec4899', // Rose
  '#8b5cf6', // Violet
  '#06b6d4', // Cyan
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#3b82f6', // Blue
  '#f43f5e', // Red
  '#14b8a6'  // Teal
];

export class RealtimeManager {
  private roomId: string;
  private currentUser: UserPresence;
  private peers: Map<string, UserPresence> = new Map();
  private channel: BroadcastChannel | null = null;
  private listeners: Set<(msg: RealtimeMessage) => void> = new Set();
  private presenceListeners: Set<(peers: UserPresence[]) => void> = new Set();
  private heartbeatTimer: number | null = null;

  constructor(roomId: string, userName: string) {
    this.roomId = roomId;
    
    // Deterministic or random unique user ID & color
    const savedUserId = localStorage.getItem('cad_realtime_uid') || 'u_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('cad_realtime_uid', savedUserId);

    const colorIndex = Math.abs(this.hashCode(userName + savedUserId)) % USER_COLORS.length;

    this.currentUser = {
      userId: savedUserId,
      userName: userName,
      color: USER_COLORS[colorIndex],
      joinedAt: Date.now(),
      lastActive: Date.now()
    };

    this.initChannel();
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  private initChannel() {
    try {
      this.channel = new BroadcastChannel(`cad_room_${this.roomId}`);
      this.channel.onmessage = (event) => {
        this.handleIncomingMessage(event.data);
      };

      // Announce join
      this.broadcast('presence_join', { user: this.currentUser });

      // Start heartbeat to clean up stale users
      this.heartbeatTimer = window.setInterval(() => {
        this.broadcast('presence_join', { user: this.currentUser });
        this.cleanupStalePeers();
      }, 5000);
    } catch (e) {
      console.warn('BroadcastChannel not supported in this environment:', e);
    }
  }

  public getCurrentUser(): UserPresence {
    return this.currentUser;
  }

  public getPeers(): UserPresence[] {
    return Array.from(this.peers.values());
  }

  public onMessage(callback: (msg: RealtimeMessage) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  public onPresenceChange(callback: (peers: UserPresence[]) => void): () => void {
    this.presenceListeners.add(callback);
    callback(this.getPeers());
    return () => this.presenceListeners.delete(callback);
  }

  public sendCursor(worldX: number, worldY: number) {
    this.currentUser.cursor = { worldX, worldY };
    this.currentUser.lastActive = Date.now();
    this.broadcast('cursor_move', { worldX, worldY });
  }

  public broadcastPin(pin: any) {
    this.broadcast('pin_add', { pin });
  }

  public broadcastDeletePin(pinId: string) {
    this.broadcast('pin_delete', { pinId });
  }

  public broadcast(type: RealtimeMessage['type'], payload: any) {
    const msg: RealtimeMessage = {
      type,
      roomId: this.roomId,
      sender: {
        userId: this.currentUser.userId,
        userName: this.currentUser.userName,
        color: this.currentUser.color
      },
      payload,
      timestamp: Date.now()
    };

    if (this.channel) {
      this.channel.postMessage(msg);
    }
  }

  private handleIncomingMessage(msg: RealtimeMessage) {
    if (!msg || msg.sender.userId === this.currentUser.userId) return;

    if (msg.type === 'presence_join') {
      const peer = msg.payload?.user;
      if (peer) {
        this.peers.set(peer.userId, { ...peer, lastActive: Date.now() });
        this.notifyPresence();
      }
    } else if (msg.type === 'presence_leave') {
      this.peers.delete(msg.sender.userId);
      this.notifyPresence();
    } else if (msg.type === 'cursor_move') {
      const peer = this.peers.get(msg.sender.userId);
      if (peer) {
        peer.cursor = { worldX: msg.payload.worldX, worldY: msg.payload.worldY };
        peer.lastActive = Date.now();
      } else {
        this.peers.set(msg.sender.userId, {
          userId: msg.sender.userId,
          userName: msg.sender.userName,
          color: msg.sender.color,
          joinedAt: Date.now(),
          lastActive: Date.now(),
          cursor: { worldX: msg.payload.worldX, worldY: msg.payload.worldY }
        });
      }
      this.notifyPresence();
    }

    this.listeners.forEach(cb => cb(msg));
  }

  private cleanupStalePeers() {
    const now = Date.now();
    let changed = false;
    for (const [id, peer] of this.peers.entries()) {
      if (now - peer.lastActive > 15000) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.notifyPresence();
    }
  }

  private notifyPresence() {
    const peerList = this.getPeers();
    this.presenceListeners.forEach(cb => cb(peerList));
  }

  public destroy() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.broadcast('presence_leave', {});
    this.channel?.close();
    this.channel = null;
    this.listeners.clear();
    this.presenceListeners.clear();
  }
}
