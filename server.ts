import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Game Types & Logic ---

type Color = 'red' | 'blue' | 'green' | 'yellow' | 'orange' | 'pink' | 'teal' | 'purple' | 'black';
type CardType = 'number' | 'skip' | 'reverse' | 'draw_one' | 'draw_two' | 'draw_five' | 'wild' | 'wild_draw_two' | 'wild_draw_color' | 'flip' | 'skip_everyone';

interface CardSide {
  color: Color;
  value: string; // '0'-'9', 'skip', 'reverse', etc.
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
  currentColor: Color | null; // For wilds
  message: string | null; // Last action message
  hostId: string;
}

// --- Deck Generation ---

function createDeck(): Card[] {
  const cards: Card[] = [];
  let idCounter = 0;

  const lightColors: Color[] = ['red', 'blue', 'green', 'yellow'];
  const darkColors: Color[] = ['orange', 'pink', 'teal', 'purple'];

  // Helper to create a card
  const addCard = (light: CardSide, dark: CardSide) => {
    cards.push({
      id: `card-${idCounter++}`,
      light,
      dark
    });
  };

  // Generate Light Side parts
  let lightSides: CardSide[] = [];
  let darkSides: CardSide[] = [];

  // --- LIGHT SIDE GENERATION ---
  lightColors.forEach(color => {
    // Numbers 1-9 (x2)
    for (let i = 1; i <= 9; i++) {
      lightSides.push({ color, value: i.toString(), type: 'number', score: i });
      lightSides.push({ color, value: i.toString(), type: 'number', score: i });
    }
    
    // Action cards (x2)
    ['draw_one', 'reverse', 'skip', 'flip'].forEach(type => {
      let val = type.replace('_', ' ').toUpperCase();
      if (type === 'draw_one') val = '+1';
      lightSides.push({ color, value: val, type: type as CardType, score: 20 });
      lightSides.push({ color, value: val, type: type as CardType, score: 20 });
    });
  });

  // Wilds (Light)
  for (let i = 0; i < 4; i++) {
    lightSides.push({ color: 'black', value: 'WILD', type: 'wild', score: 40 });
    lightSides.push({ color: 'black', value: '+2', type: 'wild_draw_two', score: 50 });
  }

  // --- DARK SIDE GENERATION ---
  darkColors.forEach(color => {
    // Numbers 1-9 (x2)
    for (let i = 1; i <= 9; i++) {
      darkSides.push({ color, value: i.toString(), type: 'number', score: i });
      darkSides.push({ color, value: i.toString(), type: 'number', score: i });
    }

    // Action cards (x2)
    ['draw_five', 'reverse', 'skip_everyone', 'flip'].forEach(type => {
      let val = type.replace('_', ' ').toUpperCase();
      if (type === 'draw_five') val = '+5';
      if (type === 'skip_everyone') val = 'SKIP ALL';
      darkSides.push({ color, value: val, type: type as CardType, score: 20 });
      darkSides.push({ color, value: val, type: type as CardType, score: 20 });
    });
  });

  // Wilds (Dark)
  for (let i = 0; i < 4; i++) {
    darkSides.push({ color: 'black', value: 'WILD', type: 'wild', score: 40 });
    darkSides.push({ color: 'black', value: 'COLOR', type: 'wild_draw_color', score: 60 });
  }

  // Shuffle both arrays independently
  lightSides = shuffleArray(lightSides);
  darkSides = shuffleArray(darkSides);

  // Combine
  const count = Math.min(lightSides.length, darkSides.length);
  for (let i = 0; i < count; i++) {
    addCard(lightSides[i], darkSides[i]);
  }

  return cards;
}

function shuffleArray<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

// --- Server Setup ---

const app = express();
const PORT = 3000;
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// In-memory store
const rooms: Record<string, GameState> = {};

// Game Logic Helpers

const getNextPlayerIndex = (current: number, direction: number, total: number) => {
  return (current + direction + total) % total;
};

const checkWin = (game: GameState) => {
  const activePlayer = game.players[game.activePlayerIndex];
  if (activePlayer.hand.length === 0) {
    game.status = 'ended';
    game.winner = activePlayer.name;
    game.message = `${activePlayer.name} wins!`;
    return true;
  }
  return false;
};

// Helper to draw cards with reshuffling
const drawCards = (game: GameState, count: number): Card[] => {
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (game.drawPile.length === 0) {
      if (game.discardPile.length <= 1) break; // Cannot reshuffle if only top card exists
      const top = game.discardPile.pop();
      game.drawPile = shuffleArray(game.discardPile);
      game.discardPile = [top!];
      game.message = "Deck reshuffled!";
    }
    const card = game.drawPile.shift();
    if (card) drawn.push(card);
  }
  return drawn;
};

const handleSpecialCard = (game: GameState, card: Card, side: 'light' | 'dark') => {
  const cardData = card[side];
  const nextIdx = getNextPlayerIndex(game.activePlayerIndex, game.direction, game.players.length);
  const nextPlayer = game.players[nextIdx];

  if (cardData.type === 'skip') {
    game.activePlayerIndex = nextIdx; // Skip next player
    game.message = `${nextPlayer.name} was skipped!`;
  } else if (cardData.type === 'skip_everyone') {
    game.message = `Everyone skipped! ${game.players[game.activePlayerIndex].name} plays again.`;
    return 'repeat_turn';
  } else if (cardData.type === 'reverse') {
    if (game.players.length === 2) {
      game.activePlayerIndex = nextIdx;
      game.message = `Reverse! ${nextPlayer.name} was skipped!`;
    } else {
      game.direction *= -1;
      game.message = `Direction reversed!`;
    }
  } else if (cardData.type === 'draw_one') {
    const drawn = drawCards(game, 1);
    nextPlayer.hand.push(...drawn);
    game.activePlayerIndex = nextIdx;
    game.message = `${nextPlayer.name} drew 1 and was skipped.`;
  } else if (cardData.type === 'draw_five') {
    const drawn = drawCards(game, 5);
    nextPlayer.hand.push(...drawn);
    game.activePlayerIndex = nextIdx;
    game.message = `${nextPlayer.name} drew 5 and was skipped.`;
  } else if (cardData.type === 'flip') {
    game.currentSide = game.currentSide === 'light' ? 'dark' : 'light';
    game.drawPile.reverse();
    game.discardPile.reverse();
    
    const topCard = game.discardPile[game.discardPile.length - 1];
    if (topCard) {
        const newSideData = topCard[game.currentSide];
        if (newSideData.color !== 'black') {
            game.currentColor = newSideData.color;
        }
    }
    
    game.message = `FLIP! Switching to ${game.currentSide.toUpperCase()} side!`;
  } else if (cardData.type === 'wild_draw_two') {
    const drawn = drawCards(game, 2);
    nextPlayer.hand.push(...drawn);
    game.activePlayerIndex = nextIdx;
    game.message = `${nextPlayer.name} drew 2 and was skipped.`;
  } else if (cardData.type === 'wild_draw_color') {
    let drawnCount = 0;
    // Cap at 10 to prevent infinite loops if something is wrong, but usually draw until color
    while (drawnCount < 10) {
        if (game.drawPile.length === 0) {
             if (game.discardPile.length <= 1) break;
             const top = game.discardPile.pop();
             game.drawPile = shuffleArray(game.discardPile);
             game.discardPile = [top!];
        }
        
        const top = game.drawPile[0];
        if (top[game.currentSide].color === game.currentColor) {
            break;
        }
        const card = game.drawPile.shift();
        if (card) nextPlayer.hand.push(card);
        drawnCount++;
    }
    game.activePlayerIndex = nextIdx;
    game.message = `${nextPlayer.name} drew cards looking for ${game.currentColor} and was skipped.`;
  }

  return 'advance';
};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_room', ({ roomId, playerName }) => {
    socket.join(roomId);
    
    if (!rooms[roomId]) {
      rooms[roomId] = {
        roomId,
        players: [],
        drawPile: [],
        discardPile: [],
        currentSide: 'light',
        activePlayerIndex: 0,
        direction: 1,
        status: 'waiting',
        winner: null,
        currentColor: null,
        message: 'Waiting for players...'
      };
    }

    const room = rooms[roomId];
    
    const existingPlayer = room.players.find(p => p.name === playerName);
    if (!existingPlayer) {
      room.players.push({
        id: socket.id,
        name: playerName,
        hand: [],
        isBot: false
      });
    } else {
      existingPlayer.id = socket.id;
    }

    io.to(roomId).emit('room_update', room);
  });

  socket.on('start_game', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.players.length < 2) return;

    room.status = 'playing';
    room.drawPile = shuffleArray(createDeck());
    
    room.players.forEach(p => {
      p.hand = room.drawPile.splice(0, 7);
    });

    let firstCard = room.drawPile.pop();
    if (firstCard) room.discardPile.push(firstCard);

    room.currentSide = 'light';
    room.currentColor = firstCard?.light.color === 'black' ? 'red' : (firstCard?.light.color || 'red');
    room.activePlayerIndex = 0;
    room.message = `Game started! ${room.players[0].name}'s turn.`;

    io.to(roomId).emit('game_state', room);
  });

  socket.on('play_card', ({ roomId, cardId, chosenColor }) => {
    const room = rooms[roomId];
    if (!room) return;

    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== room.activePlayerIndex) return;

    const player = room.players[playerIndex];
    const cardIndex = player.hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return;

    const card = player.hand[cardIndex];
    const sideData = card[room.currentSide];

    const topCard = room.discardPile[room.discardPile.length - 1];
    const topSideData = topCard[room.currentSide];
    
    const colorMatch = sideData.color === room.currentColor || sideData.color === 'black';
    const valueMatch = sideData.value === topSideData.value;
    const isWild = sideData.type === 'wild' || sideData.type === 'wild_draw_two' || sideData.type === 'wild_draw_color';

    if (!colorMatch && !valueMatch && !isWild) {
      socket.emit('error', 'Invalid move');
      return;
    }

    player.hand.splice(cardIndex, 1);
    room.discardPile.push(card);
    
    if (sideData.color === 'black') {
      room.currentColor = chosenColor || 'red';
    } else {
      room.currentColor = sideData.color;
    }

    if (checkWin(room)) {
      io.to(roomId).emit('game_state', room);
      return;
    }

    const actionResult = handleSpecialCard(room, card, room.currentSide);

    if (actionResult !== 'repeat_turn') {
      room.activePlayerIndex = getNextPlayerIndex(room.activePlayerIndex, room.direction, room.players.length);
    }

    io.to(roomId).emit('game_state', room);
  });

  socket.on('draw_card', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    
    // Validate turn
    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== room.activePlayerIndex) return;

    if (room.drawPile.length === 0) {
      const top = room.discardPile.pop();
      room.drawPile = shuffleArray(room.discardPile);
      room.discardPile = [top!];
    }

    if (room.drawPile.length > 0) {
      const card = room.drawPile.shift();
      const player = room.players[room.activePlayerIndex];
      if (card) player.hand.push(card);
      
      room.message = `${player.name} drew a card.`;
      room.activePlayerIndex = getNextPlayerIndex(room.activePlayerIndex, room.direction, room.players.length);
      
      io.to(roomId).emit('game_state', room);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;
  
  // Attach socket.io to the HTTP server
  // We need to create the HTTP server from the express app
  const httpServer = createServer(app);
  io.attach(httpServer);

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    // Handle SPA routing - return index.html for any unknown route
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
