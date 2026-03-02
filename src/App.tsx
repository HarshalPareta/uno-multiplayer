import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, RotateCcw, Copy, Users, Play } from 'lucide-react';

// --- Types (Mirroring Server) ---

type Color = 'red' | 'blue' | 'green' | 'yellow' | 'orange' | 'pink' | 'teal' | 'purple' | 'black';
type CardType = 'number' | 'skip' | 'reverse' | 'draw_one' | 'draw_two' | 'draw_five' | 'wild' | 'wild_draw_two' | 'wild_draw_color' | 'flip' | 'skip_everyone';

interface CardSide {
  color: Color;
  value: string;
  type: CardType;
  score: number;
}

interface Card {
  id: string;
  light: CardSide;
  dark: CardSide;
}

interface Player {
  id: string;
  name: string;
  hand: Card[];
  isBot: boolean;
  connected: boolean;
}

interface GameState {
  roomId: string;
  players: Player[];
  drawPile: Card[];
  discardPile: Card[];
  currentSide: 'light' | 'dark';
  activePlayerIndex: number;
  direction: 1 | -1;
  status: 'waiting' | 'playing' | 'ended';
  winner: string | null;
  currentColor: Color | null;
  message: string | null;
  hostId: string;
}

// ... (keep constants)

// --- Components ---

// ... (keep CardView)

const RotatingArrows = ({ direction, isDark }: { direction: 1 | -1, isDark: boolean }) => {
  return (
    <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 pointer-events-none opacity-20`}>
       <motion.div 
         animate={{ rotate: direction === 1 ? 360 : -360 }}
         transition={{ repeat: Infinity, duration: 10, ease: "linear" }}
         className="w-full h-full relative"
       >
          <div className={`absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 ${isDark ? 'text-white' : 'text-black'}`}>
            <RotateCcw size={48} className={direction === -1 ? "scale-x-[-1]" : ""} />
          </div>
          <div className={`absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 ${isDark ? 'text-white' : 'text-black'}`}>
            <RotateCcw size={48} className={`rotate-180 ${direction === -1 ? "scale-x-[-1]" : ""}`} />
          </div>
       </motion.div>
    </div>
  );
};

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  // ... (keep state)

  useEffect(() => {
    // Use VITE_API_URL if available, otherwise default to origin
    const apiUrl = import.meta.env.VITE_API_URL || window.location.origin;
    const newSocket = io(apiUrl); 
    setSocket(newSocket);

    // ... (keep listeners)
    
    return () => {
      newSocket.disconnect();
    };
  }, []);

  // ... (keep handlers)

  // ... (keep render logic until seating)

  const myIndex = gameState.players.findIndex(p => p.id === socket?.id);
  const isMyTurn = myIndex === gameState.activePlayerIndex;
  const currentSide = gameState.currentSide;
  const isDark = currentSide === 'dark';
  const isHost = gameState.hostId === socket?.id;

  // Calculate relative seating
  // We want "Me" at index 0 (bottom)
  // Then clockwise around the table
  let orderedPlayers: Player[] = [];
  if (myIndex !== -1) {
      // If I am in the game
      // Players: [A, B, C, D], I am C (2)
      // Order: C, D, A, B
      orderedPlayers = [
          ...gameState.players.slice(myIndex),
          ...gameState.players.slice(0, myIndex)
      ];
  } else {
      // Spectator view
      orderedPlayers = gameState.players;
  }
  
  // Remove "Me" from the rendering list for the "Opponents" section, 
  // but keep the order correct for the circle.
  // Actually, we want to render EVERYONE in the circle EXCEPT me (who is at the bottom).
  // The `orderedPlayers` array has Me at index 0.
  // So `orderedPlayers[1]` is my left, `orderedPlayers[2]` is top/across, etc.
  const opponents = orderedPlayers.slice(1);

  return (
    <div className={`min-h-screen transition-colors duration-1000 overflow-hidden relative ${isDark ? 'bg-slate-950' : 'bg-slate-100'}`}>
      
      {/* ... (keep background) */}

      {/* Header Info */}
      <div className="absolute top-4 left-4 right-4 flex justify-between items-start z-10">
        <div className={`p-4 rounded-xl backdrop-blur-md border ${isDark ? 'bg-slate-900/80 border-slate-700 text-white' : 'bg-white/80 border-slate-200 text-slate-900'} shadow-lg`}>
          <h2 className="font-bold text-lg flex items-center gap-2">
            Room: {roomId}
            <span className="text-xs opacity-50 px-2 py-1 rounded-full bg-black/10">
              {gameState.status.toUpperCase()}
            </span>
          </h2>
          {/* ... (keep waiting message) */}
          {gameState.status === 'waiting' && gameState.players.length >= 2 && isHost && (
            <button
              onClick={handleStart}
              className="mt-4 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-bold text-sm flex items-center gap-2"
            >
              <Play size={16} /> Start Game
            </button>
          )}
          {gameState.status === 'waiting' && !isHost && (
             <div className="mt-4 text-sm font-bold text-yellow-500">Waiting for host to start...</div>
          )}
        </div>

        {/* ... (keep color indicator) */}
      </div>

      {/* Game Area */}
      <div className="h-screen w-full flex flex-col items-center justify-center relative">
        
        {/* Rotating Arrows */}
        {gameState.status === 'playing' && <RotatingArrows direction={gameState.direction} isDark={isDark} />}

        {/* Opponents - Arranged in a semi-circle or specific spots */}
        {/* We can use absolute positioning based on index in `opponents` array */}
        <div className="absolute inset-0 pointer-events-none">
           {opponents.map((player, i) => {
             // Calculate position based on number of opponents
             // Simple logic: distribute evenly across the top arc
             // Total angle available: ~180 degrees (from left to right)
             const totalOpponents = opponents.length;
             const angleStep = 180 / (totalOpponents + 1);
             const angle = 180 + (i + 1) * angleStep; // 180 is left, 270 is top, 360 is right
             
             // Convert polar to cartesian (center is 50% 50%)
             // Radius: 35% of screen min dimension
             const radius = 35; // vmin
             const rad = (angle * Math.PI) / 180;
             const top = 50 + radius * Math.sin(rad);
             const left = 50 + radius * Math.cos(rad);

             const isActive = gameState.players.findIndex(p => p.id === player.id) === gameState.activePlayerIndex;

             return (
               <div 
                 key={player.id} 
                 className="absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2 pointer-events-auto transition-all duration-500"
                 style={{ top: `${top}%`, left: `${left}%` }}
               >
                  <div className={`
                    w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold shadow-lg border-4 transition-all relative
                    ${isActive ? 'border-yellow-400 scale-125 z-20' : (isDark ? 'border-slate-700 bg-slate-800 text-white' : 'border-white bg-white text-slate-800')}
                    ${!player.connected ? 'opacity-50 grayscale' : ''}
                  `}>
                    {player.name.charAt(0)}
                    {gameState.hostId === player.id && (
                        <div className="absolute -top-2 -right-2 bg-yellow-400 text-black text-[10px] px-1 rounded-full border border-white">HOST</div>
                    )}
                    {!player.connected && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full">
                            <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                        </div>
                    )}
                  </div>
                  <div className={`text-xs font-bold px-2 py-1 rounded-full ${isDark ? 'bg-slate-800 text-white' : 'bg-white text-slate-800'}`}>
                    {player.name}
                  </div>
                  <div className="flex -space-x-2">
                    {player.hand.map((_, idx) => (
                      <div key={idx} className={`w-4 h-6 rounded ${isDark ? 'bg-slate-700 border-slate-600' : 'bg-slate-300 border-white'} border shadow-sm`}></div>
                    ))}
                  </div>
               </div>
             );
           })}
        </div>

        {/* Center Table */}
        {/* ... (keep center table) */}
        
        {/* ... (keep message toast) */}

        {/* My Hand */}
        {/* ... (keep my hand) */}
        
        {/* ... (keep color picker) */}
        
        {/* ... (keep game over) */}

      </div>
    </div>
  );
}
