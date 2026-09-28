export interface UserPresence {
  userId: string;
  userName: string;
  color: string;
  avatarUrl?: string;
  joinedAt: number;
  lastActive: number;
  cursor?: {
    worldX: number;
    worldY: number;
  };
}

export interface RealtimeMessage {
  type: 'presence_join' | 'presence_leave' | 'cursor_move' | 'pin_add' | 'pin_delete' | 'layer_create';
  roomId: string;
  sender: {
    userId: string;
    userName: string;
    color: string;
  };
  payload: any;
  timestamp: number;
}
