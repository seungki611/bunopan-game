import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { Room, WSMessage, Player } from "./src/types";

// Korean License Plate Generation Helpers
function randomPlate(): string {
  const letters = ["가", "나", "다", "라", "마", "거", "너", "더", "러", "머", "버", "서", "어", "저", "고", "노", "도", "로", "모", "보", "소", "오", "조", "구", "누", "두", "루", "무", "부", "수", "우", "주", "하", "허", "호"];
  const num1 = Math.floor(Math.random() * 90 + 10); // 10 to 99
  const letter = letters[Math.floor(Math.random() * letters.length)];
  const num2 = Math.floor(Math.random() * 9000 + 1000); // 1000 to 9999
  return `${num1}${letter} ${num2}`;
}

function extractDigits(plate: string): number[] {
  return plate
    .replace(/[^0-9]/g, "")
    .split("")
    .map(Number);
}

function generateRoomCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

const rooms = new Map<string, Room>();

// WebSocket connection mapping: ws -> Client Info
interface ClientInfo {
  roomCode: string;
  playerId: string;
  ws: WebSocket;
}
const clients = new Map<WebSocket, ClientInfo>();

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  // Serve JSON payloads up to 10mb because drawings can be base64 images
  app.use(express.json({ limit: "10mb" }));

  // API Endpoints for troubleshooting / status if desired
  app.get("/api/status", (req, res) => {
    res.json({
      activeRooms: rooms.size,
      connectedClients: clients.size,
    });
  });

  // API Endpoints for fallback/polling model
  app.post("/api/rooms", (req, res) => {
    try {
      const { playerId, hostName } = req.body;
      if (!playerId || !hostName) {
        return res.status(400).json({ error: "닉네임 및 사용자 식별자가 누락되었습니다." });
      }
      const code = generateRoomCode();
      const initPlate = randomPlate();
      const newRoom: Room = {
        roomCode: code,
        hostId: playerId,
        locked: false,
        game: {
          plate: initPlate,
          digits: extractDigits(initPlate),
          currentSubmission: null,
          round: 1,
          players: {
            [playerId]: {
              id: playerId,
              name: hostName,
              score: 0,
              isHost: true,
              connected: true,
            },
          },
        },
      };

      rooms.set(code, newRoom);
      res.json({ success: true, room: newRoom });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "서버 오류가 발생했습니다." });
    }
  });

  app.post("/api/rooms/:roomCode/join", (req, res) => {
    try {
      const code = req.params.roomCode.toUpperCase();
      const { playerId, playerName } = req.body;
      if (!playerId || !playerName) {
        return res.status(400).json({ error: "닉네임 및 사용자 식별자가 누락되었습니다." });
      }
      const room = rooms.get(code);

      if (!room) {
        return res.status(404).json({ error: "존재하지 않는 방 번호입니다." });
      }

      const playerExist = room.game.players[playerId];
      if (playerExist) {
        playerExist.connected = true;
      } else {
        room.game.players[playerId] = {
          id: playerId,
          name: playerName,
          score: 0,
          isHost: false,
          connected: true,
        };
      }

      broadcastToRoom(code, { type: "sync_state", room });
      res.json({ success: true, room });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "서버 오류가 발생했습니다." });
    }
  });

  app.get("/api/rooms/:roomCode", (req, res) => {
    try {
      const code = req.params.roomCode.toUpperCase();
      const playerId = req.query.playerId as string;
      const room = rooms.get(code);
      if (!room) {
        return res.status(404).json({ error: "방을 찾을 수 없거나 만료되었습니다." });
      }
      if (playerId && room.game.players[playerId]) {
        room.game.players[playerId].connected = true;
      }
      res.json({ success: true, room });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "서버 오류" });
    }
  });

  app.post("/api/rooms/:roomCode/action", (req, res) => {
    try {
      const code = req.params.roomCode.toUpperCase();
      const { action, playerId, payload } = req.body;
      const room = rooms.get(code);
      if (!room) {
        return res.status(404).json({ error: "방을 찾을 수 없습니다." });
      }

      switch (action) {
        case "set_plate": {
          if (room.hostId !== playerId) return res.status(403).json({ error: "권한이 없습니다." });
          room.game.plate = payload.plate;
          room.game.digits = extractDigits(payload.plate);
          room.game.currentSubmission = null;
          room.locked = false;
          break;
        }

        case "submit_equation": {
          if (room.locked) {
            return res.status(400).json({ error: "이번 라운드가 이미 종결되었습니다!" });
          }
          if (room.game.currentSubmission) {
            return res.status(400).json({ error: "현재 다른 참가자의 답안이 평가 중입니다!" });
          }
          const solver = room.game.players[playerId];
          if (!solver) return res.status(404).json({ error: "플레이어 정보를 찾을 수 없습니다." });

          room.game.currentSubmission = {
            playerId,
            playerName: solver.name,
            image: payload.image,
            equationText: payload.equationText,
            submittedAt: Date.now(),
          };

          broadcastToRoom(code, { type: "sync_state", room });
          broadcastToRoom(code, { type: "new_submission_toast", playerName: solver.name });
          break;
        }

        case "judge_submission": {
          if (room.hostId !== playerId) return res.status(403).json({ error: "권한이 없습니다." });
          const submission = room.game.currentSubmission;
          if (!submission) return res.status(400).json({ error: "심사할 제출본이 없습니다." });

          if (payload.approved) {
            const winner = room.game.players[submission.playerId];
            if (winner) {
              winner.score += 1;
            }
            room.locked = true;
          } else {
            room.game.currentSubmission = null;
            room.locked = false;
          }
          break;
        }

        case "next_round": {
          if (room.hostId !== playerId) return res.status(403).json({ error: "권한이 없습니다." });
          const nextPlate = randomPlate();
          room.game.plate = nextPlate;
          room.game.digits = extractDigits(nextPlate);
          room.game.currentSubmission = null;
          room.locked = false;
          room.game.round += 1;
          break;
        }

        case "leave_room": {
          const player = room.game.players[playerId];
          if (player) {
            player.connected = false;
          }
          break;
        }
      }

      broadcastToRoom(code, { type: "sync_state", room });
      res.json({ success: true, room });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "서버 동작 오류" });
    }
  });

  // Setup WebSocket Server
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  // Broadcast to all players in a room
  function broadcastToRoom(roomCode: string, payload: WSMessage) {
    const messageStr = JSON.stringify(payload);
    for (const [ws, info] of clients.entries()) {
      if (info.roomCode === roomCode && ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    }
  }

  // Sync a single socket
  function sendToSocket(ws: WebSocket, payload: WSMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  wss.on("connection", (ws: WebSocket) => {
    ws.on("message", (rawMessage: string) => {
      try {
        const msg = JSON.parse(rawMessage) as WSMessage;

        switch (msg.type) {
          case "create_room": {
            const code = generateRoomCode();
            const initPlate = randomPlate();
            const newRoom: Room = {
              roomCode: code,
              hostId: msg.playerId,
              locked: false,
              game: {
                plate: initPlate,
                digits: extractDigits(initPlate),
                currentSubmission: null,
                round: 1,
                players: {
                  [msg.playerId]: {
                    id: msg.playerId,
                    name: msg.hostName,
                    score: 0,
                    isHost: true,
                    connected: true,
                  },
                },
              },
            };

            rooms.set(code, newRoom);
            clients.set(ws, { roomCode: code, playerId: msg.playerId, ws });

            sendToSocket(ws, { type: "sync_state", room: newRoom });
            break;
          }

          case "join_room": {
            const code = msg.roomCode.toUpperCase();
            const room = rooms.get(code);

            if (!room) {
              sendToSocket(ws, { type: "sync_state", room: null, error: "존재하지 않는 방 번호입니다." });
              break;
            }

            // Check if player already exists
            const playerExist = room.game.players[msg.playerId];
            if (playerExist) {
              playerExist.connected = true;
            } else {
              room.game.players[msg.playerId] = {
                id: msg.playerId,
                name: msg.playerName,
                score: 0,
                isHost: false,
                connected: true,
              };
            }

            clients.set(ws, { roomCode: code, playerId: msg.playerId, ws });

            // Notify everyone
            broadcastToRoom(code, { type: "sync_state", room });
            break;
          }

          case "set_plate": {
            const client = clients.get(ws);
            if (!client) break;
            const room = rooms.get(client.roomCode);
            if (!room || room.hostId !== client.playerId) break;

            room.game.plate = msg.plate;
            room.game.digits = extractDigits(msg.plate);
            room.game.currentSubmission = null;
            room.locked = false;

            broadcastToRoom(client.roomCode, { type: "sync_state", room });
            break;
          }

          case "submit_equation": {
            const client = clients.get(ws);
            if (!client) break;
            const room = rooms.get(client.roomCode);
            if (!room || room.locked) break;

            // Only allow submission if there's no active evaluation
            if (room.game.currentSubmission) {
              sendToSocket(ws, { type: "sync_state", room, error: "현재 다른 참가자의 답안이 평가 중입니다! 잠시 후 다시 제출하세요." });
              break;
            }

            const solver = room.game.players[client.playerId];
            if (!solver) break;

            room.game.currentSubmission = {
              playerId: client.playerId,
              playerName: solver.name,
              image: msg.image,
              equationText: msg.equationText,
              submittedAt: Date.now(),
            };

            // Inform everyone of the submission
            broadcastToRoom(client.roomCode, { type: "sync_state", room });
            // Host gets a nice toast or announcement
            broadcastToRoom(client.roomCode, { type: "new_submission_toast", playerName: solver.name });
            break;
          }

          case "judge_submission": {
            const client = clients.get(ws);
            if (!client) break;
            const room = rooms.get(client.roomCode);
            if (!room || room.hostId !== client.playerId) break;

            const submission = room.game.currentSubmission;
            if (!submission) break;

            if (msg.approved) {
              // Award point
              const winner = room.game.players[submission.playerId];
              if (winner) {
                winner.score += 1;
              }
              room.locked = true; // Round locks upon correct answer
            } else {
              // Reject, clear current submission so other players can buzz in/submit again
              room.game.currentSubmission = null;
              room.locked = false;
            }

            broadcastToRoom(client.roomCode, { type: "sync_state", room });
            break;
          }

          case "next_round": {
            const client = clients.get(ws);
            if (!client) break;
            const room = rooms.get(client.roomCode);
            if (!room || room.hostId !== client.playerId) break;

            const nextPlate = randomPlate();
            room.game.plate = nextPlate;
            room.game.digits = extractDigits(nextPlate);
            room.game.currentSubmission = null;
            room.locked = false;
            room.game.round += 1;

            broadcastToRoom(client.roomCode, { type: "sync_state", room });
            break;
          }

          case "ping": {
            sendToSocket(ws, { type: "pong" });
            break;
          }
        }
      } catch (err) {
        console.error("Failed to parse websocket message:", err);
      }
    });

    ws.on("close", () => {
      const client = clients.get(ws);
      if (client) {
        const room = rooms.get(client.roomCode);
        if (room) {
          const player = room.game.players[client.playerId];
          if (player) {
            player.connected = false;
          }
          // If everyone is disconnected or after some time, we could clean up.
          // For now, let's keep it simple and just sync player offline status.
          broadcastToRoom(client.roomCode, { type: "sync_state", room });
        }
        clients.delete(ws);
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
