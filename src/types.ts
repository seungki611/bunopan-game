export interface Player {
  id: string;
  name: string;
  score: number;
  isHost: boolean;
  connected: boolean;
}

export interface Submission {
  playerId: string;
  playerName: string;
  image: string; // base64 representation of drawing
  equationText?: string;
  submittedAt: number;
}

export interface GameState {
  plate: string;
  digits: number[];
  currentSubmission: Submission | null;
  round: number;
  players: Record<string, Player>;
}

export interface Room {
  roomCode: string;
  hostId: string;
  locked: boolean;
  game: GameState;
}

export type WSMessage =
  | { type: "create_room"; hostName: string; playerId: string }
  | { type: "join_room"; roomCode: string; playerName: string; playerId: string }
  | { type: "set_plate"; roomCode: string; plate: string }
  | { type: "submit_equation"; roomCode: string; image: string; equationText?: string }
  | { type: "judge_submission"; roomCode: string; approved: boolean }
  | { type: "next_round"; roomCode: string }
  | { type: "sync_state"; room: Room | null; error?: string }
  | { type: "new_submission_toast"; playerName: string }
  | { type: "ping" }
  | { type: "pong" };
