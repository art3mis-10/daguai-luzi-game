import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { Server } from 'socket.io';

import { createNewDeal, sortCards } from './game/deck.js';

import { validatePlay } from './game/rules.js';

/* =========================================================
   PATHS
   ========================================================= */

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

const publicDir = path.join(__dirname, 'public');

const gameDir = path.join(__dirname, 'game');

const dataDir = path.join(__dirname, '..', 'data');

const historyFile = path.join(dataDir, 'game-history.json');

/* =========================================================
   DATA DIRECTORY / HISTORY FILE
   ========================================================= */

if (!existsSync(dataDir)) {
  mkdirSync(dataDir, {
    recursive: true,
  });
}

function createEmptyHistory() {
  return {
    schemaVersion: 1,
    games: [],
  };
}

function loadHistory() {
  if (!existsSync(historyFile)) {
    const emptyHistory = createEmptyHistory();

    writeFileSync(historyFile, JSON.stringify(emptyHistory, null, 2), 'utf8');

    return emptyHistory;
  }

  try {
    const raw = readFileSync(historyFile, 'utf8');

    const parsed = JSON.parse(raw);

    if (!parsed || !Array.isArray(parsed.games)) {
      return createEmptyHistory();
    }

    return parsed;
  } catch (error) {
    console.error('Could not read game history:', error);

    return createEmptyHistory();
  }
}

let gameHistory = loadHistory();

function saveHistory() {
  writeFileSync(historyFile, JSON.stringify(gameHistory, null, 2), 'utf8');
}

/* =========================================================
   APP / SOCKET.IO
   ========================================================= */

const app = express();

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
});

/*
  Browser files:
    /
    /main.js
    /style.css

  Shared browser-safe game utility:
    /game/deck.js
*/
app.use(express.static(publicDir));

app.use('/game', express.static(gameDir));

app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

/* =========================================================
   ROOM STORAGE
   ========================================================= */

const rooms = new Map();

/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function nowIso() {
  return new Date().toISOString();
}

function minuteIso(timestamp) {
  return timestamp.slice(0, 16) + 'Z';
}

function generateRoomCode() {
  let roomCode;

  do {
    roomCode = Math.random().toString(36).slice(2, 8).toUpperCase();
  } while (rooms.has(roomCode));

  return roomCode;
}

function serializeCard(card) {
  return {
    id: card.id,
    deckNumber: card.deckNumber,
    rank: card.rank,
    displayRank: card.displayRank ?? null,
    suit: card.suit,
    symbol: card.symbol,
    color: card.color,
    isJoker: card.isJoker,
    jokerType: card.jokerType ?? null,
  };
}

function serializeCombination(combination) {
  if (!combination) {
    return null;
  }

  return {
    type: combination.type ?? null,

    subtype: combination.subtype ?? null,

    cardCount: combination.cardCount ?? null,

    primaryRank: combination.primaryRank ?? null,

    strength: combination.strength ?? null,

    categoryStrength: combination.categoryStrength ?? null,

    label: combination.label ?? null,

    wildAssignments: combination.wildAssignments ?? [],
  };
}

function getConnectedPlayerCount(room) {
  return room.players.filter((player) => Boolean(player.socketId)).length;
}

function getActivePlayerCount(room) {
  return room.players.filter(
    (player) => Boolean(player.socketId) && !player.hasFinished
  ).length;
}

function findNextActivePlayerIndex(room, fromIndex) {
  for (let offset = 1; offset <= 6; offset += 1) {
    const candidateIndex = (fromIndex + offset) % 6;

    const candidate = room.players[candidateIndex];

    if (candidate.socketId && !candidate.hasFinished) {
      return candidateIndex;
    }
  }

  return null;
}

function getPassesNeeded(room) {
  if (!room.state.currentLead) {
    return 0;
  }

  const leaderIndex = room.state.currentLead.playerIndex;

  const leader = room.players[leaderIndex];

  const leaderStillActive = Boolean(leader.socketId) && !leader.hasFinished;

  const activePlayerCount = getActivePlayerCount(room);

  return Math.max(1, activePlayerCount - (leaderStillActive ? 1 : 0));
}

function touchRoom(room) {
  room.state.revision += 1;
}

/* =========================================================
   GAME LOGGING
   ========================================================= */

function getGameLog(gameId) {
  return gameHistory.games.find((game) => game.gameId === gameId);
}

function createGameLog(room) {
  const dealtAt = nowIso();

  const gameId = `${room.code}-` + randomUUID();

  room.state.gameId = gameId;
  room.state.dealtAt = dealtAt;

  const gameLog = {
    gameId,

    roomCode: room.code,

    status: 'ongoing',

    dealtAt,

    dealtAtMinute: minuteIso(dealtAt),

    trumpRank: room.state.trumpRank,

    players: room.players.map((player, seatIndex) => ({
      seatIndex,

      playerId: player.id,

      name: player.name,

      team: player.team,
    })),

    initialHands: room.state.hands.map((hand, seatIndex) => ({
      seatIndex,

      playerId: room.players[seatIndex].id,

      cards: hand.map(serializeCard),
    })),

    events: [],

    finishOrder: [],

    endedAt: null,

    endedReason: null,

    finalHands: null,
  };

  gameHistory.games.push(gameLog);

  saveHistory();

  appendGameEvent(room, 'deal', {
    dealtAt,

    trumpRank: room.state.trumpRank,

    startingPlayerId: room.players[room.state.currentPlayerIndex].id,
  });
}

function appendGameEvent(room, type, details = {}) {
  if (!room.state.gameId) {
    return;
  }

  const gameLog = getGameLog(room.state.gameId);

  if (!gameLog) {
    return;
  }

  const timestamp = nowIso();

  gameLog.events.push({
    sequence: gameLog.events.length + 1,

    timestamp,

    timestampMinute: minuteIso(timestamp),

    type,

    ...details,
  });

  gameLog.finishOrder = [...room.state.finishOrder];

  saveHistory();
}

function finalizeGameLog(room, status, reason) {
  if (!room.state.gameId) {
    return;
  }

  const gameLog = getGameLog(room.state.gameId);

  if (!gameLog || gameLog.status !== 'ongoing') {
    return;
  }

  gameLog.status = status;

  gameLog.endedAt = nowIso();

  gameLog.endedReason = reason;

  gameLog.finishOrder = [...room.state.finishOrder];

  gameLog.finalHands = room.state.hands.map((hand, seatIndex) => ({
    seatIndex,

    playerId: room.players[seatIndex].id,

    cards: hand.map(serializeCard),
  }));

  saveHistory();
}

/* =========================================================
   ROOM CREATION
   ========================================================= */

function createEmptyRoom(roomCode, hostName, hostSocketId) {
  return {
    code: roomCode,

    advanceTimer: null,

    players: [
      {
        id: 1,
        name: hostName || 'Player 1',
        team: 'A',
        socketId: hostSocketId,
        hasFinished: false,
      },

      {
        id: 2,
        name: 'Empty',
        team: 'B',
        socketId: null,
        hasFinished: false,
      },

      {
        id: 3,
        name: 'Empty',
        team: 'A',
        socketId: null,
        hasFinished: false,
      },

      {
        id: 4,
        name: 'Empty',
        team: 'B',
        socketId: null,
        hasFinished: false,
      },

      {
        id: 5,
        name: 'Empty',
        team: 'A',
        socketId: null,
        hasFinished: false,
      },

      {
        id: 6,
        name: 'Empty',
        team: 'B',
        socketId: null,
        hasFinished: false,
      },
    ],

    state: {
      hands: [[], [], [], [], [], []],

      currentPlayerIndex: 0,

      trumpRank: '2',

      currentLead: null,

      lastSuccessfulPlayerIndex: null,

      consecutivePasses: 0,

      finishOrder: [],

      hasStarted: false,

      paused: false,

      phase: 'waiting',

      turnLockedUntil: null,

      revision: 0,

      gameId: null,

      dealtAt: null,
    },
  };
}

/* =========================================================
   CLIENT-SAFE STATE
   ========================================================= */

function buildClientRoomState(room, viewerSeatIndex) {
  return {
    code: room.code,

    players: room.players.map((player) => ({
      id: player.id,

      name: player.name,

      team: player.team,

      connected: Boolean(player.socketId),

      hasFinished: player.hasFinished,
    })),

    state: {
      /*
        CRITICAL:

        Only send the viewer's own
        hand to that viewer.
      */
      hands: room.state.hands.map((hand, index) =>
        index === viewerSeatIndex ? hand : []
      ),

      currentPlayerIndex: room.state.currentPlayerIndex,

      trumpRank: room.state.trumpRank,

      currentLead: room.state.currentLead,

      lastSuccessfulPlayerIndex: room.state.lastSuccessfulPlayerIndex,

      consecutivePasses: room.state.consecutivePasses,

      finishOrder: [...room.state.finishOrder],

      hasStarted: room.state.hasStarted,

      paused: room.state.paused,

      phase: room.state.phase,

      turnLockedUntil: room.state.turnLockedUntil,

      revision: room.state.revision,

      gameId: room.state.gameId,

      dealtAt: room.state.dealtAt,
    },
  };
}

function emitRoomState(room, eventName = 'roomStateUpdate') {
  room.players.forEach((player, seatIndex) => {
    if (!player.socketId) {
      return;
    }

    const clientState = buildClientRoomState(room, seatIndex);

    io.to(player.socketId).emit(eventName, clientState);
  });
}

/* =========================================================
   DESTROY ROOM
   ========================================================= */

function destroyRoom(room, reason) {
  if (room.advanceTimer) {
    clearTimeout(room.advanceTimer);

    room.advanceTimer = null;
  }

  if (room.state.gameId) {
    appendGameEvent(room, 'room_closed', {
      reason,
    });

    finalizeGameLog(room, 'aborted', reason);
  }

  io.to(room.code).emit('roomClosed', {
    reason,
  });

  io.in(room.code).socketsLeave(room.code);

  rooms.delete(room.code);
}

/* =========================================================
   PLAY DELAY / ADVANCE
   ========================================================= */

function scheduleAdvanceAfterPlay(room, playerSeatIndex) {
  if (room.advanceTimer) {
    clearTimeout(room.advanceTimer);
  }

  const gameId = room.state.gameId;

  room.advanceTimer = setTimeout(() => {
    const currentRoom = rooms.get(room.code);

    if (!currentRoom || currentRoom.state.gameId !== gameId) {
      return;
    }

    currentRoom.advanceTimer = null;

    currentRoom.state.turnLockedUntil = null;

    /*
          If only one active player
          remains, finish the game.
        */
    if (getActivePlayerCount(currentRoom) <= 1) {
      currentRoom.state.hasStarted = false;

      currentRoom.state.phase = 'finished';

      appendGameEvent(currentRoom, 'game_finished', {
        reason: 'one_player_remaining',
      });

      finalizeGameLog(currentRoom, 'completed', 'one_player_remaining');

      touchRoom(currentRoom);

      emitRoomState(currentRoom, 'gameStateUpdate');

      io.to(currentRoom.code).emit('toast', 'Game finished.');

      return;
    }

    const nextPlayerIndex = findNextActivePlayerIndex(
      currentRoom,
      playerSeatIndex
    );

    if (nextPlayerIndex === null) {
      currentRoom.state.hasStarted = false;

      currentRoom.state.phase = 'finished';

      finalizeGameLog(currentRoom, 'completed', 'no_active_next_player');

      touchRoom(currentRoom);

      emitRoomState(currentRoom, 'gameStateUpdate');

      return;
    }

    currentRoom.state.currentPlayerIndex = nextPlayerIndex;

    currentRoom.state.phase = 'turn';

    appendGameEvent(currentRoom, 'turn_advance', {
      fromPlayerId: currentRoom.players[playerSeatIndex].id,

      toPlayerId: currentRoom.players[nextPlayerIndex].id,
    });

    touchRoom(currentRoom);

    emitRoomState(currentRoom, 'gameStateUpdate');
  }, 2000);
}

/* =========================================================
   SOCKET CONNECTION
   ========================================================= */

io.on('connection', (socket) => {
  let currentRoomCode = null;

  let playerSeatIndex = null;

  /* =====================================================
       CREATE ROOM
       ===================================================== */

  socket.on('createRoom', ({ name } = {}, callback = () => {}) => {
    const roomCode = generateRoomCode();

    const cleanName = typeof name === 'string' ? name.trim().slice(0, 24) : '';

    const room = createEmptyRoom(roomCode, cleanName, socket.id);

    rooms.set(roomCode, room);

    currentRoomCode = roomCode;

    playerSeatIndex = 0;

    socket.join(roomCode);

    touchRoom(room);

    callback({
      success: true,
      roomCode,
      seatIndex: 0,
    });

    emitRoomState(room);
  });

  /* =====================================================
       JOIN / REJOIN ROOM
       ===================================================== */

  socket.on(
    'joinRoom',
    ({ roomCode, seatIndex, name } = {}, callback = () => {}) => {
      const code = String(roomCode ?? '')
        .trim()
        .toUpperCase();

      const parsedSeatIndex = Number(seatIndex);

      const room = rooms.get(code);

      if (!room) {
        callback({
          success: false,
          message: 'Room not found.',
        });

        return;
      }

      if (
        !Number.isInteger(parsedSeatIndex) ||
        parsedSeatIndex < 1 ||
        parsedSeatIndex > 5
      ) {
        callback({
          success: false,
          message: 'Choose Player 2 to Player 6.',
        });

        return;
      }

      const seat = room.players[parsedSeatIndex];

      if (seat.socketId) {
        callback({
          success: false,
          message: 'That seat is already occupied.',
        });

        return;
      }

      const cleanName =
        typeof name === 'string' ? name.trim().slice(0, 24) : '';

      /*
          If this is a reconnect,
          preserve the old name
          unless a new one is supplied.
        */
      if (cleanName) {
        seat.name = cleanName;
      } else if (seat.name === 'Empty') {
        seat.name = `Player ${parsedSeatIndex + 1}`;
      }

      seat.socketId = socket.id;

      currentRoomCode = code;

      playerSeatIndex = parsedSeatIndex;

      socket.join(code);

      /*
          Resume if all six players
          are connected again.
        */
      if (room.state.hasStarted && getConnectedPlayerCount(room) === 6) {
        room.state.paused = false;

        appendGameEvent(room, 'game_resumed', {
          rejoinedPlayerId: seat.id,
        });
      } else if (room.state.gameId) {
        appendGameEvent(room, 'player_rejoined', {
          playerId: seat.id,
        });
      }

      touchRoom(room);

      callback({
        success: true,
        roomCode: code,
        seatIndex: parsedSeatIndex,
      });

      emitRoomState(room);
    }
  );

  /* =====================================================
       DEAL
       ===================================================== */

  socket.on('dealCards', (callback = () => {}) => {
    if (!currentRoomCode || playerSeatIndex !== 0) {
      callback({
        success: false,
        message: 'Only Player 1 can deal.',
      });

      return;
    }

    const room = rooms.get(currentRoomCode);

    if (!room) {
      callback({
        success: false,
        message: 'Room not found.',
      });

      return;
    }

    if (getConnectedPlayerCount(room) !== 6) {
      callback({
        success: false,
        message: 'All 6 players must be connected before dealing.',
      });

      return;
    }

    /*
          If host redeals during an
          existing game, preserve the
          previous game in history.
        */
    if (room.state.gameId && room.state.hasStarted) {
      appendGameEvent(room, 'game_aborted', {
        reason: 'host_redeal',
      });

      finalizeGameLog(room, 'aborted', 'host_redeal');
    }

    if (room.advanceTimer) {
      clearTimeout(room.advanceTimer);

      room.advanceTimer = null;
    }

    const newDeal = createNewDeal();

    room.state.hands = newDeal.hands.map((hand) => sortCards(hand));

    room.state.currentPlayerIndex = 0;

    room.state.currentLead = null;

    room.state.lastSuccessfulPlayerIndex = null;

    room.state.consecutivePasses = 0;

    room.state.finishOrder = [];

    room.state.hasStarted = true;

    room.state.paused = false;

    room.state.phase = 'turn';

    room.state.turnLockedUntil = null;

    room.players.forEach((player) => {
      player.hasFinished = false;
    });

    createGameLog(room);

    touchRoom(room);

    callback({
      success: true,
      gameId: room.state.gameId,
      dealtAt: room.state.dealtAt,
    });

    emitRoomState(room, 'gameStateUpdate');
  });

  /* =====================================================
       PLAY CARDS
       ===================================================== */

  socket.on('playCards', ({ cardIds } = {}, callback = () => {}) => {
    const room = rooms.get(currentRoomCode);

    if (!room || !room.state.hasStarted) {
      callback({
        success: false,
        message: 'No active game.',
      });

      return;
    }

    if (room.state.paused) {
      callback({
        success: false,
        message: 'Game is paused because a player is disconnected.',
      });

      return;
    }

    if (room.state.phase !== 'turn') {
      callback({
        success: false,
        message: 'Wait for the current play to finish displaying.',
      });

      return;
    }

    if (room.state.currentPlayerIndex !== playerSeatIndex) {
      callback({
        success: false,
        message: "It's not your turn.",
      });

      return;
    }

    if (!Array.isArray(cardIds) || cardIds.length === 0) {
      callback({
        success: false,
        message: 'Select at least one card.',
      });

      return;
    }

    const uniqueCardIds = [...new Set(cardIds)];

    const currentHand = room.state.hands[playerSeatIndex];

    const selectedCards = currentHand.filter((card) =>
      uniqueCardIds.includes(card.id)
    );

    if (selectedCards.length !== uniqueCardIds.length) {
      callback({
        success: false,
        message: 'One or more selected cards are not in your hand.',
      });

      return;
    }

    const validation = validatePlay(
      selectedCards,
      room.state.trumpRank,
      room.state.currentLead?.combination ?? null
    );

    if (!validation.valid) {
      callback({
        success: false,
        message: validation.reason,
      });

      return;
    }

    const handCountBefore = currentHand.length;

    room.state.hands[playerSeatIndex] = currentHand.filter(
      (card) => !uniqueCardIds.includes(card.id)
    );

    const handCountAfter = room.state.hands[playerSeatIndex].length;

    room.state.currentLead = {
      playerIndex: playerSeatIndex,

      combination: validation.combination,

      cards: selectedCards,
    };

    room.state.lastSuccessfulPlayerIndex = playerSeatIndex;

    room.state.consecutivePasses = 0;

    let finished = false;

    if (handCountAfter === 0) {
      finished = true;

      room.players[playerSeatIndex].hasFinished = true;

      const playerId = room.players[playerSeatIndex].id;

      if (!room.state.finishOrder.includes(playerId)) {
        room.state.finishOrder.push(playerId);
      }
    }

    /*
          Two-second synchronized
          display period.
        */
    room.state.phase = 'showing-play';

    room.state.turnLockedUntil = Date.now() + 2000;

    appendGameEvent(room, 'play', {
      playerId: room.players[playerSeatIndex].id,

      seatIndex: playerSeatIndex,

      team: room.players[playerSeatIndex].team,

      cards: selectedCards.map(serializeCard),

      combination: serializeCombination(validation.combination),

      handCountBefore,

      handCountAfter,

      finished,

      currentFinishOrder: [...room.state.finishOrder],
    });

    touchRoom(room);

    callback({
      success: true,
    });

    /*
          Everyone sees the cards
          immediately.
        */
    emitRoomState(room, 'gameStateUpdate');

    /*
          Server — not the browsers —
          advances the turn after 2s.
        */
    scheduleAdvanceAfterPlay(room, playerSeatIndex);
  });

  /* =====================================================
       PASS
       ===================================================== */

  socket.on('passTurn', (callback = () => {}) => {
    const room = rooms.get(currentRoomCode);

    if (!room || !room.state.hasStarted) {
      callback({
        success: false,
        message: 'No active game.',
      });

      return;
    }

    if (room.state.paused) {
      callback({
        success: false,
        message: 'Game is paused because a player is disconnected.',
      });

      return;
    }

    if (room.state.phase !== 'turn') {
      callback({
        success: false,
        message: 'Wait for the current play to finish displaying.',
      });

      return;
    }

    if (room.state.currentPlayerIndex !== playerSeatIndex) {
      callback({
        success: false,
        message: "It's not your turn.",
      });

      return;
    }

    if (!room.state.currentLead) {
      callback({
        success: false,
        message: 'The leading player cannot pass.',
      });

      return;
    }

    const leadBeforePass = {
      playerIndex: room.state.currentLead.playerIndex,

      combination: serializeCombination(room.state.currentLead.combination),

      cards: room.state.currentLead.cards.map(serializeCard),
    };

    room.state.consecutivePasses += 1;

    const passesNeeded = getPassesNeeded(room);

    let trickEnded = false;

    let nextPlayerIndex = null;

    if (room.state.consecutivePasses >= passesNeeded) {
      trickEnded = true;

      const previousLeader = room.state.lastSuccessfulPlayerIndex;

      room.state.currentLead = null;

      room.state.consecutivePasses = 0;

      if (
        previousLeader !== null &&
        room.players[previousLeader].socketId &&
        !room.players[previousLeader].hasFinished
      ) {
        nextPlayerIndex = previousLeader;
      } else {
        nextPlayerIndex = findNextActivePlayerIndex(
          room,
          previousLeader ?? playerSeatIndex
        );
      }
    } else {
      nextPlayerIndex = findNextActivePlayerIndex(room, playerSeatIndex);
    }

    if (nextPlayerIndex === null) {
      room.state.hasStarted = false;

      room.state.phase = 'finished';
    } else {
      room.state.currentPlayerIndex = nextPlayerIndex;

      room.state.phase = 'turn';
    }

    appendGameEvent(room, 'pass', {
      playerId: room.players[playerSeatIndex].id,

      seatIndex: playerSeatIndex,

      /*
              We only know that the
              browser/user manually
              pressed Pass.

              We deliberately do NOT
              claim forced/voluntary
              until the legal-response
              generator exists.
            */
      passSource: 'manual',

      leadAtPass: leadBeforePass,

      trickEnded,

      nextPlayerId:
        nextPlayerIndex === null ? null : room.players[nextPlayerIndex].id,
    });

    if (!room.state.hasStarted) {
      finalizeGameLog(room, 'completed', 'no_active_next_player');
    }

    touchRoom(room);

    callback({
      success: true,
    });

    emitRoomState(room, 'gameStateUpdate');
  });

  /* =====================================================
       DISCONNECT
       ===================================================== */

  socket.on('disconnect', () => {
    if (!currentRoomCode || playerSeatIndex === null) {
      return;
    }

    const room = rooms.get(currentRoomCode);

    if (!room) {
      return;
    }

    /*
          PLAYER 1 IS HOST.

          Host closes tab/window,
          room immediately disappears.
        */
    if (playerSeatIndex === 0) {
      destroyRoom(room, 'host_disconnected');

      return;
    }

    const player = room.players[playerSeatIndex];

    player.socketId = null;

    /*
          Preserve their name and hand
          so they can rejoin the same
          seat later.
        */
    if (room.state.hasStarted) {
      room.state.paused = true;

      appendGameEvent(room, 'player_disconnected', {
        playerId: player.id,

        seatIndex: playerSeatIndex,
      });

      io.to(room.code).emit(
        'toast',
        `${player.name} disconnected. Game paused.`
      );
    }

    touchRoom(room);

    emitRoomState(room);
  });
});

/* =========================================================
   START SERVER
   ========================================================= */

const PORT = Number(process.env.PORT) || 3000;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Daguai Luzi server running on port ${PORT}`);

  console.log(`Game history: ${historyFile}`);
});
