import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Trophy, 
  Crown, 
  Copy, 
  Check, 
  Users, 
  Play, 
  RotateCcw, 
  Send, 
  Smartphone, 
  Plus, 
  ArrowRight, 
  HelpCircle, 
  Smile, 
  Link2,
  ListCheck,
  CheckCircle,
  XCircle,
  Sparkles,
  RefreshCw,
  LogOut
} from "lucide-react";
import { Room, WSMessage, Player, Submission } from "./types";
import { Whiteboard, WhiteboardRef } from "./components/Whiteboard";
import { Scoreboard } from "./components/Scoreboard";

// Unique ID persistent across sessions
const STORAGE_PREFIX = "plate_game_";
const getPersistedId = () => {
  let id = localStorage.getItem(`${STORAGE_PREFIX}player_id`);
  if (!id) {
    id = "p_" + Math.random().toString(36).substring(2, 11);
    localStorage.setItem(`${STORAGE_PREFIX}player_id`, id);
  }
  return id;
};

const getPersistedName = () => {
  return localStorage.getItem(`${STORAGE_PREFIX}player_name`) || "";
};

const setPersistedName = (name: string) => {
  localStorage.setItem(`${STORAGE_PREFIX}player_name`, name);
};

export default function App() {
  const playerId = getPersistedId();
  
  const [role, setRole] = useState<"host" | "player" | null>(null);
  const [playerName, setPlayerName] = useState<string>(getPersistedName());
  const [roomCode, setRoomCode] = useState<string>("");
  const [room, setRoom] = useState<Room | null>(null);
  
  // Connection states
  const [statusText, setStatusText] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<boolean>(false);
  const [connected, setConnected] = useState<boolean>(false);
  
  // Input fields in the dynamic views
  const [customPlateInput, setCustomPlateInput] = useState<string>("");
  const [typedEquation, setTypedEquation] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);
  
  // Canvas whiteboard reference
  const whiteboardRef = useRef<WhiteboardRef>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | any>(null);

  // Parse URL on load for sharing
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get("room");
    if (roomParam) {
      setRoomCode(roomParam.toUpperCase().substring(0, 4));
    }
  }, []);

  // HTTP/WS unified action sender
  const executeAction = async (action: string, payload: any = {}) => {
    const currentCode = room?.roomCode || roomCode;
    if (!currentCode) return;

    // Try WebSocket first
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      let type = "";
      switch (action) {
        case "set_plate": type = "set_plate"; break;
        case "submit_equation": type = "submit_equation"; break;
        case "judge_submission": type = "judge_submission"; break;
        case "next_round": type = "next_round"; break;
        case "leave_room": type = "leave_room"; break;
      }
      if (type) {
        wsRef.current.send(JSON.stringify({
          type,
          roomCode: currentCode,
          playerId,
          ...payload
        }));
        return;
      }
    }

    // HTTP Action Fallback
    try {
      const response = await fetch(`/api/rooms/${currentCode}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          playerId,
          payload
        })
      });
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.room) {
          setRoom(data.room);
          setErrorMsg(null);
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        setErrorMsg(errorData.error || "작업을 수행하는 중 오류가 발생했습니다.");
      }
    } catch (err) {
      console.error("HTTP action fallback failed:", err);
    }
  };

  // Connect to WS (Optimistic attempt)
  const connectWebSocket = (callbackOnOpen?: () => void) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    setConnecting(true);
    setStatusText("서버 연결 중...");
    
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}`;
    
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setConnecting(false);
        setStatusText("연결 성공!");
        setErrorMsg(null);
        if (callbackOnOpen) {
          callbackOnOpen();
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WSMessage;

          switch (msg.type) {
            case "sync_state":
              if (msg.error) {
                setErrorMsg(msg.error);
                setRoom(null);
                setRole(null);
              } else if (msg.room) {
                setRoom(msg.room);
                setErrorMsg(null);
                if (msg.room.hostId === playerId) {
                  setRole("host");
                } else {
                  setRole("player");
                }
              }
              break;

            case "new_submission_toast":
              // Handle toast if wanted
              break;
          }
        } catch (err) {
          console.error("Error handling message:", err);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        setConnecting(false);
        setStatusText("연결 일시중단 (HTTP 우회)");
        
        // Quietly reconnect in background
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket(() => {
            if (roomCode) {
              const cleanName = playerName || getPersistedName() || "참가자";
              if (role === "host") {
                wsRef.current?.send(JSON.stringify({
                  type: "create_room",
                  hostName: cleanName,
                  playerId
                }));
              } else {
                wsRef.current?.send(JSON.stringify({
                  type: "join_room",
                  roomCode,
                  playerName: cleanName,
                  playerId
                }));
              }
            }
          });
        }, 5000);
      };

      ws.onerror = () => {
        setConnecting(false);
        setConnected(false);
        console.warn("WebSocket fallback activated: using HTTP polling.");
      };
    } catch (e) {
      setConnecting(false);
      setConnected(false);
      console.warn("WebSocket initialization failed:", e);
    }
  };

  // HTTP Polling Fallback Effect - Hybrid Sync
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    
    if (roomCode && room) {
      const pollIntervalMs = connected ? 4000 : 1500; // safety slow-poll when WS is active, fast-poll when fallback
      
      interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/rooms/${roomCode}?playerId=${playerId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.success && data.room) {
              setRoom(data.room);
              // Ensure roles sync
              if (data.room.hostId === playerId) {
                setRole("host");
              } else {
                setRole("player");
              }
            }
          }
        } catch (err) {
          console.error("HTTP Polling synced state error:", err);
        }
      }, pollIntervalMs);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [roomCode, connected, room, playerId]);

  // Automatically reset canvas and inputs when round advances
  const prevRoundRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (room?.game?.round !== undefined) {
      if (prevRoundRef.current !== undefined && room.game.round > prevRoundRef.current) {
        // Round changed! Clear drawing layout & user inputs
        whiteboardRef.current?.clearCanvas();
        setTypedEquation("");
      }
      prevRoundRef.current = room.game.round;
    }
  }, [room?.game?.round]);

  // Automatically sync WebSocket state with room code when online
  useEffect(() => {
    if (connected && room?.roomCode && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const cleanName = playerName || getPersistedName() || "플레이어";
      wsRef.current.send(JSON.stringify({
        type: "join_room",
        roomCode: room.roomCode,
        playerName: cleanName,
        playerId
      }));
    }
  }, [connected, room?.roomCode, playerId, playerName]);

  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };
  }, []);

  // Action: Create Room
  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = playerName.trim() || "호스트";
    setPersistedName(cleanName);
    setConnecting(true);

    // Kick off background optimistic websocket setup
    connectWebSocket();

    // Instantly create room via API endpoint to keep deployment ultra-resilient
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, hostName: cleanName }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.room) {
          setRoom(data.room);
          setRoomCode(data.room.roomCode);
          setRole("host");
          setConnecting(false);
          setErrorMsg(null);
          return;
        }
      }
      const dataErr = await res.json().catch(() => ({}));
      setErrorMsg(dataErr.error || "방 개설 중 문제가 생겼습니다.");
    } catch (err) {
      console.error("HTTP create room failed, trying websocket fallback:", err);
      setErrorMsg("서버와의 통신이 원활하지 않습니다. 잠시 후 회복됩니다.");
    }
    setConnecting(false);
  };

  // Action: Join Room
  const handleJoinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = playerName.trim() || `참가자_${Math.floor(1000 + Math.random() * 9000)}`;
    const cleanRoomCode = roomCode.trim().toUpperCase();

    if (!cleanRoomCode) {
      setErrorMsg("방 코드를 입력해주세요.");
      return;
    }

    setPersistedName(cleanName);
    setRoomCode(cleanRoomCode);
    setConnecting(true);

    // Background WS connect
    connectWebSocket();

    // Directly execute joint request via REST API
    try {
      const res = await fetch(`/api/rooms/${cleanRoomCode}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, playerName: cleanName }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.room) {
          setRoom(data.room);
          setRole(data.room.hostId === playerId ? "host" : "player");
          setConnecting(false);
          setErrorMsg(null);
          return;
        }
      }
      const dataErr = await res.json().catch(() => ({}));
      setErrorMsg(dataErr.error || "방 입장 중 존재하지 않는 방 코드이거나 만료되었습니다.");
    } catch (err) {
      console.error("HTTP join room failed:", err);
      setErrorMsg("서버 통신 실패. 방 입장에 실패했습니다.");
    }
    setConnecting(false);
  };

  // Action: Set Plate
  const handleSetPlate = () => {
    if (!customPlateInput.trim()) return;
    executeAction("set_plate", { plate: customPlateInput.trim() });
    setCustomPlateInput("");
  };

  // Action: Generate Random Plate
  const handleRandomPlate = () => {
    executeAction("next_round");
  };

  // Action: Submit Equation Draw & Text
  const handleSubmitEquation = () => {
    if (room?.locked) return;
    
    const dataUrl = whiteboardRef.current?.getImageDataUrl() || "";
    if (!dataUrl) {
      setErrorMsg("풀이판에 필기 후 제출해 주세요.");
      return;
    }

    executeAction("submit_equation", {
      image: dataUrl,
      equationText: typedEquation.trim()
    });
  };

  // Action: Judge Score
  const handleJudge = (approved: boolean) => {
    executeAction("judge_submission", { approved });
    setTypedEquation("");
    whiteboardRef.current?.clearCanvas();
  };

  const handleNextRound = () => {
    executeAction("next_round");
    setTypedEquation("");
    whiteboardRef.current?.clearCanvas();
  };

  // Action: Leave Room
  const handleLeaveRoom = () => {
    if (wsRef.current) wsRef.current.close();
    if (roomCode) {
      executeAction("leave_room");
    }
    setRoom(null);
    setRole(null);
    setRoomCode("");
    setErrorMsg(null);
  };

  // Share URL creation
  const getShareUrl = () => {
    if (!room) return "";
    return `${window.location.origin}${window.location.pathname}?room=${room.roomCode}`;
  };

  const copyShareLink = () => {
    navigator.clipboard.writeText(getShareUrl()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Render Korean Style Plate Icon
  const renderPlateGraphic = (plateStr: string) => {
    if (!plateStr) {
      return (
        <div className="text-center italic text-slate-400 py-4 playful-font font-bold">
          문제가 아직 출제되지 않았습니다. 🚗
        </div>
      );
    }
    
    return (
      <div className="flex justify-center my-6">
        <div className="relative korean-plate py-5 px-10 inline-flex flex-col items-center select-none max-w-full">
          {/* Subtle screw marks for plate feeling */}
          <div className="absolute top-2.5 left-4 w-4 h-4 rounded-full bg-slate-200 border-2 border-slate-900 flex items-center justify-center">
            <div className="w-1 h-3 bg-slate-800 rotate-45" />
          </div>
          <div className="absolute top-2.5 right-4 w-4 h-4 rounded-full bg-slate-200 border-2 border-slate-900 flex items-center justify-center">
            <div className="w-1 h-3 bg-slate-800 -rotate-45" />
          </div>
 
          <div className="font-mono text-3xl sm:text-5xl font-black tracking-widest text-slate-900 uppercase px-2 font-mono">
            {plateStr}
          </div>
          <div className="text-[10px] text-slate-500 tracking-wider mt-1 font-black playful-font">
            ★ REPUBLIC OF KOREA ★
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#fef08a] text-slate-900 flex flex-col playful-font">
      {/* Header Bar */}
      <header className="bg-white border-b-4 border-slate-900 sticky top-0 z-50 shadow-[3px_3px_0px_rgba(0,0,0,0.15)]">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3 cursor-pointer select-none" onClick={handleLeaveRoom}>
            <div className="w-12 h-12 bg-blue-500 text-white rounded-2xl flex items-center justify-center text-2xl border-3 border-slate-950 shadow-[3px_3px_0px_#1e293b] hover:rotate-6 transition-transform">
              🚗
            </div>
            <div>
              <h1 className="font-black text-lg md:text-2xl tracking-tight text-slate-900 flex items-center gap-1.5 playful-font">
                번호판 등식 게임
              </h1>
              <p className="text-[9px] md:text-2xs text-slate-500 font-extrabold uppercase tracking-wider">
                License Plate Equation Game
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {connected && (
              <span className="flex items-center space-x-1.5 px-3 py-1 bg-emerald-100 text-emerald-800 text-xs font-black rounded-full border-2 border-emerald-900 shadow-[2px_2px_0px_#064e3b]">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse border border-emerald-700" />
                <span>접속 완료</span>
              </span>
            )}
            {connecting && (
              <span className="flex items-center space-x-1.5 px-3 py-1 bg-amber-100 text-amber-800 text-xs font-black rounded-full border-2 border-amber-900 animate-pulse shadow-[2px_2px_0px_#78350f]">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                <span>연결 중</span>
              </span>
            )}
            {!connected && !connecting && room && (
              <span className="flex items-center space-x-1.5 px-3 py-1 bg-blue-100 text-blue-800 text-xs font-black rounded-full border-2 border-blue-900 shadow-[2px_2px_0px_#1e3a8a]" title="웹소켓 우회 모드: HTTP 폴링 상태">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse border border-blue-700" />
                <span>실시간 (HTTP 우회) ⚡</span>
              </span>
            )}
            {room && (
              <button 
                onClick={handleLeaveRoom}
                className="flex items-center space-x-1 text-slate-800 hover:bg-slate-100 text-xs font-extrabold px-3 py-2 rounded-xl border-2 border-slate-900 bg-white transition-all shadow-[2px_2px_0px_#000] active:translate-y-0.5 active:shadow-none"
                title="나가기"
              >
                <LogOut className="w-3.5 h-3.5 font-bold" />
                <span className="hidden sm:inline">방 퇴장</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 flex flex-col justify-center">
        {/* Persistent Error / Alert Banner */}
        <AnimatePresence>
          {errorMsg && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-4 p-3.5 bg-rose-50 border-3 border-rose-950 text-rose-800 rounded-xl text-xs md:text-sm flex items-center justify-between shadow-[3px_3px_0px_#4c0519]"
            >
              <div className="flex items-center space-x-2">
                <span className="text-base font-bold">⚠️</span>
                <span className="font-extrabold">{errorMsg}</span>
              </div>
              <button 
                onClick={() => setErrorMsg(null)}
                className="text-rose-600 hover:text-rose-900 font-black ml-2 text-xs border-b-2 border-rose-600"
              >
                닫기
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 1. START PANEL (Role is null) */}
        {!room && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start my-6"
          >
            {/* Left Guidance column */}
            <div className="md:col-span-7 space-y-5">
              <div className="bg-blue-600 text-white border-4 border-slate-900 rounded-[24px] p-6 shadow-[5px_5px_0px_#1e293b] relative overflow-hidden">
                {/* Background graphic */}
                <div className="absolute right-0 bottom-0 opacity-15 text-[150px] leading-none select-none pointer-events-none translate-x-10 translate-y-10">
                  🚗
                </div>
                
                <span className="px-3 py-1 bg-white/20 rounded-full text-xs font-black text-slate-100 border border-white/30 tracking-wider">
                  실시간 멀티 배틀 ⚡
                </span>
                <h2 className="text-2xl md:text-3xl font-black mt-4 tracking-tight leading-snug playful-font">
                  차량 번호판 숫자를 모아<br />
                  가장 먼저 등식을 만드세요!
                </h2>
                
                <p className="text-blue-100 text-xs md:text-sm mt-3 leading-relaxed font-bold">
                  도로 위의 자동차 번호판 숫자를 활용하는 흥미진진한 지능형 두뇌 게임입니다. 
                  친구나 동료와 대기실 코드를 공유하여, 누가 가장 먼저 논리적인 완성 수식을 제출할지 겨뤄 보세요!
                </p>

                <div className="mt-6 flex flex-wrap gap-2 text-xs font-extrabold text-blue-900">
                  <span className="px-3 py-1.5 bg-yellow-400 rounded-xl border-2 border-slate-900">#수학퍼즐</span>
                  <span className="px-3 py-1.5 bg-emerald-400 rounded-xl border-2 border-slate-900">★ 실시간 연동</span>
                  <span className="px-3 py-1.5 bg-pink-300 rounded-xl border-2 border-slate-900">#칠판필기</span>
                </div>
              </div>

              {/* Game rules card */}
              <div className="card-vibrant p-5">
                <h3 className="font-extrabold text-sm text-slate-900 flex items-center space-x-1.5 mb-4 border-b pb-2 border-slate-200">
                  <ListCheck className="w-5 h-5 text-blue-600" />
                  <span className="text-base font-black">게임 규칙 및 공략</span>
                </h3>
                <ul className="space-y-3 text-xs md:text-sm text-slate-800 font-bold">
                  <li className="flex items-start space-x-2.5">
                    <span className="flex-none bg-yellow-400 text-slate-900 border-2 border-slate-900 w-6 h-6 rounded-lg flex items-center justify-center font-black">1</span>
                    <span className="pt-0.5">방장(호스트)이 출제한 번호판 속 <b className="text-blue-600">모든 숫자</b> 혹은 <b className="text-blue-600">일부 숫자들</b>만을 조합합니다.</span>
                  </li>
                  <li className="flex items-start space-x-2.5">
                    <span className="flex-none bg-emerald-400 text-slate-900 border-2 border-slate-900 w-6 h-6 rounded-lg flex items-center justify-center font-black">2</span>
                    <span className="pt-0.5">사칙연산 <code className="bg-slate-100 border border-slate-300 px-1.5 py-0.5 rounded font-black font-mono">+ - * /</code> 과 등고 <code className="bg-slate-100 border border-slate-300 px-1.5 py-0.5 rounded font-black font-mono">=</code>, 그리고 괄호 <code className="bg-slate-100 border border-slate-300 px-1.5 py-0.5 rounded font-black font-mono">( )</code>를 써서 올바른 등식을 완성합니다.</span>
                  </li>
                  <li className="flex items-start space-x-2.5">
                    <span className="flex-none bg-blue-400 text-slate-900 border-2 border-slate-900 w-6 h-6 rounded-lg flex items-center justify-center font-black">3</span>
                    <span className="pt-0.5">내 풀이판에 손가락이나 마우스로 빠르게 손글씨를 그리거나 수식 텍스트를 입력해 <b className="text-slate-900">제출</b> 누르기!</span>
                  </li>
                  <li className="flex items-start space-x-2.5">
                    <span className="flex-none bg-pink-400 text-slate-900 border-2 border-slate-900 w-6 h-6 rounded-lg flex items-center justify-center font-black">4</span>
                    <span className="pt-0.5">가장 빨리 제출한 식을 방장이 실시간 심사하여 맞을 경우 득점합니다!</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Right Enter / Create room actions */}
            <div className="md:col-span-5 space-y-5">
              {/* Profile Card */}
              <div className="card-vibrant p-5">
                <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-2">
                  플레이어 닉네임 설정 ✏️
                </label>
                <div className="relative">
                  <input
                    type="text"
                    maxLength={12}
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder="이름이나 별명을 입력하세요"
                    className="w-full pl-4 pr-10 py-3 bg-slate-50 border-3 border-slate-900 rounded-xl text-sm font-extrabold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all text-slate-900"
                  />
                  <span className="absolute right-3.5 top-3.5 text-sm select-none">😎</span>
                </div>
              </div>

              {/* Box 1: Create room */}
              <div className="card-vibrant p-5 space-y-4">
                <div className="flex items-center space-x-2 border-b pb-2 border-slate-100">
                  <Crown className="w-5 h-5 text-amber-500" />
                  <h3 className="font-extrabold text-slate-900 text-sm md:text-base">새로운 게임 방 개설</h3>
                </div>
                <p className="text-slate-600 text-xs md:text-sm font-bold leading-relaxed">
                  방장이 되어 친구들에게 코드를 제공하고 임의 번호판 문제를 출제 및 직접 채점하는 권한을 가집니다.
                </p>
                <button
                  type="button"
                  onClick={handleCreateRoom}
                  className="w-full py-3 bg-emerald-400 hover:bg-emerald-500 text-slate-950 border-3 border-slate-900 rounded-xl text-xs font-black transition-all flex items-center justify-center space-x-1.5 shadow-[3px_3px_0px_#052e16] active:translate-y-0.5 active:shadow-none btn-vibrant-success"
                >
                  <Plus className="w-4 h-4 text-slate-950 stroke-[3px]" />
                  <span>새로운 등식 방 만들기</span>
                </button>
              </div>

              {/* Box 2: Join room */}
              <div className="card-vibrant p-5 space-y-4">
                <div className="flex items-center space-x-2 border-b pb-2 border-slate-100">
                  <Smartphone className="w-5 h-5 text-blue-600" />
                  <h3 className="font-extrabold text-slate-900 text-sm md:text-base">기존 대기소 입장</h3>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-wider mb-1">
                    4자리 방 코드 입력 🔑
                  </label>
                  <input
                    type="text"
                    maxLength={4}
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                    placeholder="예: XYZA"
                    className="w-full px-3 py-3 bg-slate-50 border-3 border-slate-900 rounded-xl text-center text-lg font-black tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white text-slate-900"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleJoinRoom}
                  className="w-full py-3 bg-blue-400 hover:bg-blue-500 text-white border-3 border-slate-900 rounded-xl text-xs font-black transition-all flex items-center justify-center space-x-1.5 shadow-[3px_3px_0px_#1e3a8a] active:translate-y-0.5 active:shadow-none btn-vibrant"
                >
                  <span>대기소 입장하기</span>
                  <ArrowRight className="w-4 h-4 text-white stroke-[3px]" />
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* 2. ACTIVE GAME ROOMS PANEL */}
        {room && (
          <div className="my-6 space-y-6">
            
            {/* Top Share & Status Card */}
            <div className="card-vibrant p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="px-2.5 py-1 bg-slate-900 text-white text-[10px] font-black rounded-lg tracking-wider">ROOM CODE</span>
                  <span className="text-3xl font-black text-slate-950 font-mono tracking-wider">{room.roomCode}</span>
                </div>
                <p className="text-slate-600 font-bold ml-0.5 text-xs flex items-center space-x-1.5">
                  <Link2 className="w-4 h-4 text-slate-500" />
                  <span className="truncate max-w-xs md:max-w-md">초대 주소: {getShareUrl()}</span>
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={copyShareLink}
                  className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all border-2 border-slate-900 ${
                    copied 
                      ? "bg-emerald-300 text-slate-900 shadow-none translate-y-0.5" 
                      : "bg-white hover:bg-slate-100 text-slate-800 shadow-[2px_2px_0px_#000]"
                  }`}
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? "복사 완료!" : "초대 링크 복사"}</span>
                </button>
                <div className="text-xs text-slate-900 flex items-center space-x-1.5 px-4 py-2 bg-yellow-300 rounded-xl border-2 border-slate-900 font-extrabold shadow-[2px_2px_0px_#000]">
                  <Users className="w-4 h-4 text-slate-900" />
                  <span>접속원: {Object.keys(room.game.players).length}명</span>
                </div>
              </div>
            </div>

            {/* Game Dashboard Screen Splits */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
              
              {/* LEFT COLUMN: Problems, whites boards, judging controls */}
              <div className="md:col-span-8 space-y-6">
                
                {/* Section A: License Plate graphic display */}
                <div className="bg-slate-950 text-slate-100 border-4 border-slate-900 p-6 rounded-[24px] relative overflow-hidden shadow-[6px_6px_0px_#1e293b]">
                  <div className="absolute right-0 top-0 opacity-10 text-[100px] select-none translate-x-5 -translate-y-5">
                    🎯
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="px-3 py-1 bg-white/10 rounded-full text-[10px] font-black text-white flex items-center space-x-1 border border-white/20">
                      <Sparkles className="w-3.5 h-3.5 text-yellow-400 animate-pulse" />
                      <span>이번 라운드 숫자 문제 ({room.game.round}회)</span>
                    </span>

                    {room.locked && (
                      <span className="px-2.5 py-1 bg-rose-500 text-white text-[10px] font-bold rounded-full border border-rose-700 animate-bounce">
                        라운드 마감됨
                      </span>
                    )}
                  </div>

                  {renderPlateGraphic(room.game.plate)}

                  {/* Digits break down display */}
                  <div className="mt-4 flex flex-col items-center">
                    <div className="text-slate-400 text-xs font-black mb-2 tracking-wide text-center">사용 가능한 수량 목록</div>
                    <div className="flex gap-2 flex-wrap justify-center">
                      {room.game.digits.length === 0 ? (
                        <span className="text-xs text-slate-500 italic">번호판에 포함된 숫자가 없습니다. 다른 번호판을 사용하세요.</span>
                      ) : (
                        room.game.digits.map((digit, i) => (
                          <div
                            key={i}
                            className="w-12 h-12 rounded-full bg-yellow-400 text-slate-950 border-3 border-slate-950 flex items-center justify-center font-black text-xl shadow-[3px_3px_0px_#000] font-mono hover:scale-110 hover:-rotate-6 transition-all cursor-default select-none pb-0.5"
                          >
                            {digit}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                {/* ROLE CONTROLS COMPONENT */}

                {/* 1. HOST SCREEN SPECIFICS */}
                {role === "host" && (
                  <div className="space-y-6">
                    {/* Submission under review logic */}
                    <div className="card-vibrant p-5 space-y-4">
                      <h3 className="font-extrabold text-slate-900 border-b border-slate-200 pb-3 text-sm md:text-base flex items-center space-x-1.5">
                        <ListCheck className="w-5 h-5 text-amber-500 stroke-[3px]" />
                        <span className="text-base font-black">실시간 정답 심사 제어소</span>
                      </h3>

                      {!room.game.currentSubmission ? (
                        <div className="text-center py-12 text-slate-500">
                          <div className="text-4xl mb-3 animate-pulse">⏳</div>
                          <p className="text-sm font-extrabold playful-font">참가자가 버저(정답 제출)를 누르기를 기다리는 중입니다.</p>
                          <p className="text-xs text-slate-400 mt-1">도전자들이 풀이를 맞추면 여기에 즉시 칠판이 뜹니다!</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between p-3.5 bg-blue-50 border-3 border-blue-200 rounded-2xl shadow-[2px_2px_0px_rgba(0,0,0,0.05)]">
                            <div className="flex items-center space-x-2">
                              <span className="text-xl">⚡</span>
                              <div>
                                <span className="font-black text-slate-900 text-sm md:text-base">
                                  {room.game.currentSubmission.playerName}
                                </span>
                                <span className="text-xs md:text-sm text-slate-700 ml-1 font-bold">님이 버저를 가장 빨리 눌렀습니다!</span>
                              </div>
                            </div>
                            <span className="text-xs font-mono font-bold text-slate-500 shrink-0">
                              시각: {new Date(room.game.currentSubmission.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                            </span>
                          </div>

                          {/* Typed formula string helper if present */}
                          {room.game.currentSubmission.equationText && (
                            <div className="p-4 bg-slate-950 text-emerald-400 border-3 border-slate-900 rounded-2xl text-center font-bold text-xl md:text-3xl font-mono shadow-[3px_3px_0px_#000] tracking-wider word-break-all">
                              {room.game.currentSubmission.equationText}
                            </div>
                          )}

                          {/* Image display board */}
                          <div className="border-4 border-slate-900 bg-white rounded-2xl overflow-hidden shadow-lg flex flex-col items-center">
                            <div className="w-full bg-slate-100 border-b-3 border-slate-900 py-2 px-3 text-xs font-black text-slate-700 tracking-wider uppercase text-center">
                              📝 자필 풀이판 (실시간 드로잉)
                            </div>
                            <img
                              src={room.game.currentSubmission.image}
                              alt="Player solution"
                              className="max-h-[300px] object-contain bg-white p-2"
                            />
                          </div>

                          {/* Judge Actions buttons */}
                          <div className="grid grid-cols-2 gap-3 pt-2">
                            <button
                              onClick={() => handleJudge(true)}
                              className="flex items-center justify-center space-x-1.5 py-3.5 rounded-xl font-black bg-emerald-400 hover:bg-emerald-500 text-slate-950 border-3 border-slate-950 shadow-[3px_3px_0px_#064e3b] text-sm transition-transform active:translate-y-0.5 active:shadow-none btn-vibrant-success"
                            >
                              <CheckCircle className="w-4 h-4 stroke-[3px]" />
                              <span>정답으로 인정 (득점)</span>
                            </button>
                            <button
                              onClick={() => handleJudge(false)}
                              className="flex items-center justify-center space-x-1.5 py-3.5 rounded-xl font-black bg-rose-400 hover:bg-rose-500 text-slate-950 border-3 border-slate-950 shadow-[3px_3px_0px_#4c0519] text-sm transition-transform active:translate-y-0.5 active:shadow-none btn-vibrant-danger"
                            >
                              <XCircle className="w-4 h-4 stroke-[3px]" />
                              <span>오답 처리 (다시 풀기)</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Problem controls and round operations */}
                    <div className="card-vibrant p-5 space-y-4">
                      <h3 className="font-extrabold text-slate-950 text-base border-b pb-2 border-slate-200">🛠️ 출제제어 관리 콘솔</h3>

                      <div className="space-y-4">
                        {/* Custom problem input */}
                        <div>
                          <label className="block text-xs font-black text-slate-500 uppercase tracking-wider mb-1.5">
                            수동 차량 번호 생성 (예: 12가 3456)
                          </label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              maxLength={15}
                              value={customPlateInput}
                              onChange={(e) => setCustomPlateInput(e.target.value)}
                              placeholder="직접 번호판 텍스트 입력..."
                              className="flex-1 px-4 py-2.5 bg-slate-50 border-3 border-slate-900 rounded-xl text-sm font-extrabold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                            />
                            <button
                              onClick={handleSetPlate}
                              className="px-4 py-2.5 bg-slate-950 hover:bg-slate-800 text-white border-3 border-slate-950 rounded-xl text-xs font-extrabold transition-transform active:translate-y-0.5 shadow-[2px_2px_0px_#000]"
                            >
                              출제 적용
                            </button>
                          </div>
                        </div>

                        {/* Trigger logic buttons */}
                        <div className="grid grid-cols-2 gap-3 pt-2">
                          <button
                            type="button"
                            onClick={handleRandomPlate}
                            className="flex items-center justify-center space-x-1.5 py-3 bg-white hover:bg-slate-100 text-slate-900 border-3 border-slate-950 rounded-xl text-xs font-black transition-all shadow-[3px_3px_0px_#1e293b] active:translate-y-0.5 active:shadow-none"
                          >
                            <RefreshCw className="w-4 h-4 stroke-[3px]" />
                            <span>무작위 새로운 번호판</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleNextRound}
                            className="flex items-center justify-center space-x-1.5 py-3 bg-amber-400 hover:bg-amber-500 text-slate-950 border-3 border-slate-950 rounded-xl text-xs font-black transition-all shadow-[3px_3px_0px_#78350f] active:translate-y-0.5 active:shadow-none"
                          >
                            <Play className="w-4 h-4 stroke-[3px]" />
                            <span>다음 라운드 시작</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. PLAYER SCREEN SPECIFICS */}
                {role === "player" && (
                  <div className="space-y-6">
                    {/* Drawing slate component */}
                    <div className="card-vibrant p-5 space-y-4">
                      <div className="flex items-center justify-between border-b-2 border-slate-200 pb-2.5">
                        <h3 className="font-extrabold text-slate-900 text-sm md:text-base flex items-center space-x-1.5">
                          <span className="text-base">📋</span>
                          <span className="font-black text-slate-950">내 등식 풀이판</span>
                        </h3>
                        <span className="text-xs text-slate-600 font-bold">
                          손으로 그리거나 키보드로 적으세요!✏️
                        </span>
                      </div>

                      {/* Whiteboard with active reference */}
                      <Whiteboard 
                        ref={whiteboardRef} 
                        disabled={!!room.game.currentSubmission || room.locked} 
                      />

                      {/* Text based entry option container */}
                      <div>
                        <label className="block text-xs font-black text-slate-600 uppercase tracking-wider mb-1.5">
                          완성 수식 및 등식 입력 (옵션, 글씨를 알아보기 힘들 때 적어두세요)
                        </label>
                        <input
                          type="text"
                          value={typedEquation}
                          onChange={(e) => setTypedEquation(e.target.value)}
                          disabled={!!room.game.currentSubmission || room.locked}
                          placeholder="예: 1 + 2 + 3 = 6 (사용 가능한 수량 목록 안에서만 기재)"
                          className="w-full px-4 py-3 bg-slate-50 border-3 border-slate-900 rounded-xl text-sm font-extrabold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white disabled:opacity-50 text-slate-900"
                        />
                      </div>

                      {/* Submit action panel */}
                      <div className="pt-2">
                        {room.game.currentSubmission ? (
                          room.game.currentSubmission.playerId === playerId ? (
                            <div className="w-full py-4 bg-amber-100 border-3 border-slate-900 rounded-xl flex items-center justify-center space-x-2 text-slate-900 font-black text-xs md:text-sm shadow-[3px_3px_0px_#000]">
                              <span className="w-3 h-3 rounded-full bg-amber-500 animate-ping border border-amber-700" />
                              <span>내 등식 제출 완료! 방장의 정답 채점를 기다리는 중...</span>
                            </div>
                          ) : (
                            <div className="w-full py-4 bg-white border-3 border-slate-900 rounded-xl flex items-center justify-center space-x-2 text-slate-700 font-black text-xs md:text-sm shadow-[3px_3px_0px_#000]">
                              <span>⚠️ 다른 참가자({room.game.currentSubmission.playerName})가 먼저 버저를 눌러 대기 중입니다.</span>
                            </div>
                          )
                        ) : room.locked ? (
                          <div className="w-full py-4 bg-rose-100 border-3 border-slate-900 rounded-xl flex items-center justify-center text-rose-800 font-black text-xs md:text-sm shadow-[3px_3px_0px_#000]">
                            이번 라운드가 이미 종결되었습니다. 다음 문제를 기약하세요! 🏁
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={handleSubmitEquation}
                            className="w-full py-4 bg-emerald-400 hover:bg-emerald-500 text-slate-950 border-3 border-slate-950 rounded-xl font-black text-sm shadow-[4px_4px_0px_#000] active:translate-y-1 active:shadow-none transition-all flex items-center justify-center space-x-2 btn-vibrant-success"
                          >
                            <Send className="w-4 h-4 text-slate-950 stroke-[3px]" />
                            <span>가장 먼저 정답 제출 완료 (버저 누르기!)</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Shared viewing of the current active submission */}
                    {room.game.currentSubmission && (
                      <div className="card-vibrant p-5 space-y-3">
                        <h4 className="font-extrabold text-slate-950 text-xs md:text-sm tracking-wider uppercase flex items-center space-x-1.5 border-b pb-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse border border-blue-700" />
                          <span>현재 채점 중인 대기 수식 ({room.game.currentSubmission.playerName} 님)</span>
                        </h4>

                        {room.game.currentSubmission.equationText && (
                          <div className="p-3 bg-slate-950 text-emerald-400 border-3 border-slate-900 rounded-xl text-center font-mono font-black text-lg md:text-2xl shadow-[2px_2px_0px_#000] tracking-widest">
                            {room.game.currentSubmission.equationText}
                          </div>
                        )}

                        <div className="border-3 border-slate-900 bg-slate-100 rounded-2xl overflow-hidden flex flex-col items-center">
                          <img
                            src={room.game.currentSubmission.image}
                            alt="Other player's drawn board"
                            className="max-h-[220px] object-contain py-2 bg-white w-full"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* RIGHT COLUMN: Player lists & Scoreboards */}
              <div className="md:col-span-4 space-y-6">
                
                {/* Scoreboard block card */}
                <div className="card-vibrant p-5 space-y-4">
                  <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                    <h3 className="font-extrabold text-slate-950 text-base flex items-center space-x-1.5 playful-font">
                      <Trophy className="w-4.5 h-4.5 text-yellow-500 animate-pulse stroke-[3px]" />
                      <span className="font-black">실시간 명예 승부판</span>
                    </h3>
                  </div>

                  <Scoreboard players={room.game.players} hostId={room.hostId} />
                </div>

                {/* Helpful Hints block */}
                <div className="card-vibrant bg-white p-5 text-xs text-slate-800 space-y-3 leading-relaxed">
                  <h4 className="font-black text-slate-950 text-sm flex items-center space-x-1 border-b pb-1.5">
                    <HelpCircle className="w-4 h-4 text-blue-600 stroke-[3.5px]" />
                    <span className="playful-font">재밌게 노는 미니 가이드 ⭐️</span>
                  </h4>
                  <p className="font-bold">
                    <strong className="text-blue-600">Q. 정답은 자동 채점되나요?</strong><br />
                    실제 참석자가 채점을 진행하는 인간 호스트 채점 방식입니다! 넉살 좋고 기발한 등식도 방장의 기지에 따라 얼마든지 정답으로 통과될 수 있습니다!
                  </p>
                  <p className="font-bold">
                    <strong className="text-emerald-600">Q. 정답 등식이 불가능하다면?</strong><br />
                    방장은 언제든지 마음에 드는 차량 번호를 수동 출제하거나, "무작위 번호판" 버튼을 눌러 새 라운의 차량을 빠르게 소출시킬 수 있습니다.
                  </p>
                </div>
              </div>

            </div>

          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className="bg-white border-t-4 border-slate-900 mt-16 py-8 text-center text-xs text-slate-800 font-extrabold uppercase tracking-wider select-none">
        <p>© 2026 License Plate Equation Game. Powered by Node.js & React</p>
        <p className="text-[10px] text-slate-400 mt-1 playful-font font-black tracking-normal">★ VIBRANT NEOMORPHIC HAND-DRAWN EDITION ★</p>
      </footer>
    </div>
  );
}
