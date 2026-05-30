import { FC } from "react";
import { Player } from "../types";
import { Trophy, Crown, CheckCircle2, User, WifiOff } from "lucide-react";

interface ScoreboardProps {
  players: Record<string, Player>;
  hostId: string;
}

export const Scoreboard: FC<ScoreboardProps> = ({ players, hostId }) => {
  const playerList = (Object.values(players) as Player[]).sort((a, b) => b.score - a.score);

  if (playerList.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500 font-bold text-sm playful-font">
        현재 대기실에 참가자가 없습니다. 🚗
      </div>
    );
  }

  const maxScore = Math.max(...playerList.map((p) => p.score), 0);

  return (
    <div className="w-full">
      <div className="space-y-3">
        {playerList.map((p, idx) => {
          const isWinner = p.score === maxScore && maxScore > 0;
          const isHost = p.id === hostId;

          return (
            <div
              key={p.id}
              className={`flex items-center gap-3 p-3.5 rounded-2xl border-3 transition-all duration-100 ${
                idx === 0 && p.score > 0
                  ? "bg-blue-50 border-blue-500 shadow-[3px_3px_0px_#2563eb]"
                  : "bg-white border-slate-900 shadow-[3px_3px_0px_#1e293b]"
              }`}
            >
              {/* Position Circle */}
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-black playful-font text-base border-2 border-slate-900 ${
                  idx === 0
                    ? "bg-yellow-400 text-slate-900"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                {idx + 1}
              </div>

              {/* Avatar Indicator */}
              <div className="relative flex-none">
                <div className="w-9 h-9 rounded-full bg-slate-950 text-white font-extrabold flex items-center justify-center border-2 border-slate-900 select-none">
                  {isHost ? (
                    <Crown className="w-4 h-4 text-yellow-400" />
                  ) : (
                    p.name.charAt(0)
                  )}
                </div>
                {/* Connectivity Status dot */}
                <span
                  className={`absolute -bottom-0.5 -right-0.5 block h-3 w-3 rounded-full border-2 border-slate-950 ${
                    p.connected ? "bg-emerald-400 animate-pulse" : "bg-neutral-300"
                  }`}
                  title={p.connected ? "이용 중" : "자리 비움"}
                />
              </div>

              {/* User details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="font-bold text-slate-900 text-sm md:text-base playful-font truncate">
                    {p.name}
                  </p>
                  {isHost && (
                    <span className="px-1.5 py-0.5 text-[9px] font-black tracking-wide text-blue-900 bg-blue-100 border-2 border-blue-300 rounded">
                      HOST
                    </span>
                  )}
                  {!p.connected && (
                    <span className="flex items-center gap-0.5 text-[9px] font-bold text-slate-400">
                      <WifiOff className="w-3 h-3" />
                      <span>OFF</span>
                    </span>
                  )}
                </div>
                <p className={`text-xs font-black uppercase ${idx === 0 && p.score > 0 ? "text-blue-600 animate-bounce" : "text-slate-500"}`}>
                  {p.score}점
                </p>
              </div>

              {/* Icon badges */}
              {isWinner && (
                <div className="text-xl animate-bounce">
                  ⭐️
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
