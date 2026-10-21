import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { randomUUID } from 'crypto';
import { Server } from 'socket.io';

import {
  createNewDeal,
  sortCards,
} from './game/deck.js';

import {
  validatePlay,
} from './game/rules.js';

/* =========================================================
   PATHS
   ========================================================= */

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

const publicDir =
  path.join(
    __dirname,
    'public'
  );

const gameDir =
  path.join(
    __dirname,
    'game'
  );

const dataDir =
  path.join(
    __dirname,
    '..',
    'data'
  );

const historyFile =
  path.join(
    dataDir,
    'game-history.json'
  );

/* =========================================================
   GITHUB CONFIG
   ========================================================= */

const GITHUB_TOKEN =
  process.env.GITHUB_TOKEN || '';

const GITHUB_OWNER =
  process.env.GITHUB_OWNER ||
  'art3mis-10';

const GITHUB_REPO =
  process.env.GITHUB_REPO ||
  'Daguai_Luzi';

const GITHUB_BRANCH =
  process.env.GITHUB_BRANCH ||
  'main';

const GITHUB_HISTORY_PATH =
  process.env.GITHUB_HISTORY_PATH ||
  'data/game-history.json';

const githubSyncEnabled =
  Boolean(
    GITHUB_TOKEN &&
    GITHUB_OWNER &&
    GITHUB_REPO
  );

/* =========================================================
   LOCAL DATA FILE
   ========================================================= */

if (!existsSync(dataDir)) {
  mkdirSync(
    dataDir,
    {
      recursive: true,
    }
  );
}

function createEmptyHistory() {
  return {
    schemaVersion: 1,

    lastUpdatedAt: null,

    games: [],
  };
}

function loadLocalHistory() {
  if (!existsSync(historyFile)) {
    return createEmptyHistory();
  }

  try {
    const raw =
      readFileSync(
        historyFile,
        'utf8'
      );

    const parsed =
      JSON.parse(raw);

    if (
      !parsed ||
      !Array.isArray(parsed.games)
    ) {
      return createEmptyHistory();
    }

    return parsed;
  } catch (error) {
    console.error(
      'Could not load local history:',
      error
    );

    return createEmptyHistory();
  }
}

function writeLocalHistory(
  history
) {
  writeFileSync(
    historyFile,

    JSON.stringify(
      history,
      null,
      2
    ),

    'utf8'
  );
}

/* =========================================================
   GITHUB API
   ========================================================= */

function getGitHubApiUrl() {
  return (
    `https://api.github.com/repos/` +
    `${encodeURIComponent(GITHUB_OWNER)}/` +
    `${encodeURIComponent(GITHUB_REPO)}/` +
    `contents/` +
    `${GITHUB_HISTORY_PATH}` +
    `?ref=${encodeURIComponent(GITHUB_BRANCH)}`
  );
}

function getGitHubHeaders() {
  return {
    Accept:
      'application/vnd.github+json',

    Authorization:
      `Bearer ${GITHUB_TOKEN}`,

    'X-GitHub-Api-Version':
      '2022-11-28',

    'User-Agent':
      'daguai-luzi-server',
  };
}

async function readHistoryFromGitHub() {
  if (!githubSyncEnabled) {
    return null;
  }

  try {
    const response =
      await fetch(
        getGitHubApiUrl(),
        {
          headers:
            getGitHubHeaders(),
        }
      );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const text =
        await response.text();

      throw new Error(
        `GitHub GET failed: ` +
        `${response.status} ${text}`
      );
    }

    const data =
      await response.json();

    if (!data.content) {
      return null;
    }

    const decoded =
      Buffer
        .from(
          data.content,
          'base64'
        )
        .toString(
          'utf8'
        );

    const parsed =
      JSON.parse(decoded);

    if (
      !parsed ||
      !Array.isArray(parsed.games)
    ) {
      return null;
    }

    return {
      history: parsed,
      sha: data.sha,
    };
  } catch (error) {
    console.error(
      'Could not read history from GitHub:',
      error
    );

    return null;
  }
}

async function pushHistoryToGitHub(
  history
) {
  if (!githubSyncEnabled) {
    return;
  }

  try {
    let existingSha = null;

    const existingResponse =
      await fetch(
        getGitHubApiUrl(),
        {
          headers:
            getGitHubHeaders(),
        }
      );

    if (
      existingResponse.ok
    ) {
      const existingData =
        await existingResponse.json();

      existingSha =
        existingData.sha;
    } else if (
      existingResponse.status !==
      404
    ) {
      const text =
        await existingResponse.text();

      throw new Error(
        `Could not fetch current GitHub file: ` +
        `${existingResponse.status} ${text}`
      );
    }

    const jsonText =
      JSON.stringify(
        history,
        null,
        2
      );

    const content =
      Buffer
        .from(
          jsonText,
          'utf8'
        )
        .toString(
          'base64'
        );

    const body = {
      message:
        `Update game history ` +
        new Date()
          .toISOString(),

      content,

      branch:
        GITHUB_BRANCH,
    };

    if (existingSha) {
      body.sha =
        existingSha;
    }

    const putUrl =
      `https://api.github.com/repos/` +
      `${encodeURIComponent(GITHUB_OWNER)}/` +
      `${encodeURIComponent(GITHUB_REPO)}/` +
      `contents/` +
      `${GITHUB_HISTORY_PATH}`;

    const response =
      await fetch(
        putUrl,
        {
          method: 'PUT',

          headers: {
            ...getGitHubHeaders(),

            'Content-Type':
              'application/json',
          },

          body:
            JSON.stringify(
              body
            ),
        }
      );

    if (!response.ok) {
      const text =
        await response.text();

      throw new Error(
        `GitHub PUT failed: ` +
        `${response.status} ${text}`
      );
    }

    console.log(
      'Game history synced to GitHub.'
    );
  } catch (error) {
    console.error(
      'Could not sync history to GitHub:',
      error
    );
  }
}

/* =========================================================
   HISTORY INITIALIZATION
   ========================================================= */

let gameHistory =
  loadLocalHistory();

/*
  Render filesystem may reset.

  Therefore, when server starts,
  prefer the latest GitHub copy
  if one exists.
*/
async function initializeHistory() {
  if (!githubSyncEnabled) {
    console.log(
      'GitHub history sync disabled.'
    );

    writeLocalHistory(
      gameHistory
    );

    return;
  }

  const remote =
    await readHistoryFromGitHub();

  if (
    remote?.history
  ) {
    gameHistory =
      remote.history;

    writeLocalHistory(
      gameHistory
    );

    console.log(
      `Loaded ${gameHistory.games.length} game(s) from GitHub.`
    );
  } else {
    writeLocalHistory(
      gameHistory
    );

    await pushHistoryToGitHub(
      gameHistory
    );
  }
}

/* =========================================================
   SAFE GITHUB SYNC QUEUE
   ========================================================= */

/*
  Multiple game events can occur
  close together.

  We serialize GitHub writes so
  two commits never race each other.
*/
let githubSyncChain =
  Promise.resolve();

let syncTimer = null;

function queueGitHubSync() {
  if (!githubSyncEnabled) {
    return;
  }

  /*
    Wait briefly so closely-spaced
    state changes can be combined.
  */
  clearTimeout(syncTimer);

  syncTimer =
    setTimeout(
      () => {
        const snapshot =
          JSON.parse(
            JSON.stringify(
              gameHistory
            )
          );

        githubSyncChain =
          githubSyncChain
            .then(
              () =>
                pushHistoryToGitHub(
                  snapshot
                )
            )
            .catch(
              (error) => {
                console.error(
                  'GitHub sync queue error:',
                  error
                );
              }
            );
      },
      800
    );
}

function saveHistory() {
  gameHistory.lastUpdatedAt =
    new Date().toISOString();

  writeLocalHistory(
    gameHistory
  );

  queueGitHubSync();
}

/* =========================================================
   APP / SOCKET.IO
   ========================================================= */

const app =
  express();

const httpServer =
  createServer(app);

const io =
  new Server(
    httpServer,
    {
      cors: {
        origin: '*',
      },
    }
  );

app.use(
  express.static(
    publicDir
  )
);

app.use(
  '/game',
  express.static(
    gameDir
  )
);

app.get(
  '/',
  (_req, res) => {
    res.sendFile(
      path.join(
        publicDir,
        'index.html'
      )
    );
  }
);

/* =========================================================
   OPTIONAL HISTORY CHECK ENDPOINT
   ========================================================= */

/*
  This is intentionally NOT the
  full hidden-card history endpoint.

  It simply confirms whether logging
  is working without exposing hands.
*/
app.get(
  '/api/history-status',
  (_req, res) => {
    res.json({
      logging: true,

      githubSync:
        githubSyncEnabled,

      gameCount:
        gameHistory.games.length,

      lastUpdatedAt:
        gameHistory.lastUpdatedAt,

      githubRepository:
        `${GITHUB_OWNER}/${GITHUB_REPO}`,

      githubPath:
        GITHUB_HISTORY_PATH,
    });
  }
);

/* =========================================================
   ROOM STORAGE
   ========================================================= */

const rooms =
  new Map();

/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function nowIso() {
  return (
    new Date().toISOString()
  );
}

function minuteIso(
  timestamp
) {
  return (
    timestamp.slice(
      0,
      16
    ) + 'Z'
  );
}

function generateRoomCode() {
  let roomCode;

  do {
    roomCode =
      Math
        .random()
        .toString(36)
        .slice(2, 8)
        .toUpperCase();
  } while (
    rooms.has(roomCode)
  );

  return roomCode;
}

function serializeCard(
  card
) {
  return {
    id:
      card.id,

    deckNumber:
      card.deckNumber,

    rank:
      card.rank,

    displayRank:
      card.displayRank ??
      null,

    suit:
      card.suit,

    symbol:
      card.symbol,

    color:
      card.color,

    isJoker:
      card.isJoker,

    jokerType:
      card.jokerType ??
      null,
  };
}

function serializeCombination(
  combination
) {
  if (!combination) {
    return null;
  }

  return {
    type:
      combination.type ??
      null,

    subtype:
      combination.subtype ??
      null,

    cardCount:
      combination.cardCount ??
      null,

    primaryRank:
      combination.primaryRank ??
      null,

    strength:
      combination.strength ??
      null,

    categoryStrength:
      combination.categoryStrength ??
      null,

    label:
      combination.label ??
      null,

    wildAssignments:
      combination.wildAssignments ??
      [],
  };
}

function getConnectedPlayerCount(
  room
) {
  return (
    room.players.filter(
      (player) =>
        Boolean(
          player.socketId
        )
    ).length
  );
}

function getActivePlayerCount(
  room
) {
  return (
    room.players.filter(
      (player) =>
        Boolean(
          player.socketId
        ) &&
        !player.hasFinished
    ).length
  );
}

function findNextActivePlayerIndex(
  room,
  fromIndex
) {
  for (
    let offset = 1;
    offset <= 6;
    offset += 1
  ) {
    const candidateIndex =
      (
        fromIndex +
        offset
      ) % 6;

    const candidate =
      room.players[
        candidateIndex
      ];

    if (
      candidate.socketId &&
      !candidate.hasFinished
    ) {
      return candidateIndex;
    }
  }

  return null;
}

function getPassesNeeded(
  room
) {
  if (
    !room.state.currentLead
  ) {
    return 0;
  }

  const leaderIndex =
    room.state.currentLead
      .playerIndex;

  const leader =
    room.players[
      leaderIndex
    ];

  const leaderStillActive =
    Boolean(
      leader.socketId
    ) &&
    !leader.hasFinished;

  const activePlayerCount =
    getActivePlayerCount(
      room
    );

  return Math.max(
    1,

    activePlayerCount -
      (
        leaderStillActive
          ? 1
          : 0
      )
  );
}

function touchRoom(
  room
) {
  room.state.revision += 1;
}

/* =========================================================
   GAME LOGGING
   ========================================================= */

function getGameLog(
  gameId
) {
  return (
    gameHistory.games.find(
      (game) =>
        game.gameId ===
        gameId
    )
  );
}

function createGameLog(
  room
) {
  const dealtAt =
    nowIso();

  const gameId =
    `${room.code}-` +
    randomUUID();

  room.state.gameId =
    gameId;

  room.state.dealtAt =
    dealtAt;

  const gameLog = {
    gameId,

    roomCode:
      room.code,

    status:
      'ongoing',

    dealtAt,

    dealtAtMinute:
      minuteIso(
        dealtAt
      ),

    trumpRank:
      room.state.trumpRank,

    players:
      room.players.map(
        (
          player,
          seatIndex
        ) => ({
          seatIndex,

          playerId:
            player.id,

          name:
            player.name,

          team:
            player.team,
        })
      ),

    initialHands:
      room.state.hands.map(
        (
          hand,
          seatIndex
        ) => ({
          seatIndex,

          playerId:
            room.players[
              seatIndex
            ].id,

          cards:
            hand.map(
              serializeCard
            ),
        })
      ),

    events: [],

    finishOrder: [],

    endedAt: null,

    endedReason: null,

    finalHands: null,
  };

  gameHistory.games.push(
    gameLog
  );

  saveHistory();

  appendGameEvent(
    room,
    'deal',
    {
      dealtAt,

      trumpRank:
        room.state
          .trumpRank,

      startingPlayerId:
        room.players[
          room.state
            .currentPlayerIndex
        ].id,
    }
  );
}

function appendGameEvent(
  room,
  type,
  details = {}
) {
  if (
    !room.state.gameId
  ) {
    return;
  }

  const gameLog =
    getGameLog(
      room.state.gameId
    );

  if (!gameLog) {
    return;
  }

  const timestamp =
    nowIso();

  gameLog.events.push({
    sequence:
      gameLog.events.length +
      1,

    timestamp,

    timestampMinute:
      minuteIso(
        timestamp
      ),

    type,

    ...details,
  });

  gameLog.finishOrder =
    [
      ...room.state
        .finishOrder,
    ];

  saveHistory();
}

function finalizeGameLog(
  room,
  status,
  reason
) {
  if (
    !room.state.gameId
  ) {
    return;
  }

  const gameLog =
    getGameLog(
      room.state.gameId
    );

  if (
    !gameLog ||
    gameLog.status !==
      'ongoing'
  ) {
    return;
  }

  gameLog.status =
    status;

  gameLog.endedAt =
    nowIso();

  gameLog.endedReason =
    reason;

  gameLog.finishOrder =
    [
      ...room.state
        .finishOrder,
    ];

  gameLog.finalHands =
    room.state.hands.map(
      (
        hand,
        seatIndex
      ) => ({
        seatIndex,

        playerId:
          room.players[
            seatIndex
          ].id,

        cards:
          hand.map(
            serializeCard
          ),
      })
    );

  saveHistory();
}

/* =========================================================
   ROOM CREATION
   ========================================================= */

function createEmptyRoom(
  roomCode,
  hostName,
  hostSocketId
) {
  return {
    code:
      roomCode,

    advanceTimer:
      null,

    players: [
      {
        id: 1,

        name:
          hostName ||
          'Player 1',

        team: 'A',

        socketId:
          hostSocketId,

        hasFinished:
          false,
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
      hands: [
        [],
        [],
        [],
        [],
        [],
        [],
      ],

      currentPlayerIndex:
        0,

      trumpRank:
        '2',

      currentLead:
        null,

      lastSuccessfulPlayerIndex:
        null,

      consecutivePasses:
        0,

      finishOrder:
        [],

      hasStarted:
        false,

      paused:
        false,

      phase:
        'waiting',

      turnLockedUntil:
        null,

      revision:
        0,

      gameId:
        null,

      dealtAt:
        null,
    },
  };
}

/* =========================================================
   CLIENT-SAFE STATE
   ========================================================= */

function buildClientRoomState(
  room,
  viewerSeatIndex
) {
  return {
    code:
      room.code,

    players:
      room.players.map(
        (player) => ({
          id:
            player.id,

          name:
            player.name,

          team:
            player.team,

          connected:
            Boolean(
              player.socketId
            ),

          hasFinished:
            player.hasFinished,
        })
      ),

    state: {
      /*
        Only the local player
        receives their own hand.
      */
      hands:
        room.state.hands.map(
          (
            hand,
            index
          ) =>
            index ===
            viewerSeatIndex
              ? hand
              : []
        ),

      currentPlayerIndex:
        room.state
          .currentPlayerIndex,

      trumpRank:
        room.state
          .trumpRank,

      currentLead:
        room.state
          .currentLead,

      lastSuccessfulPlayerIndex:
        room.state
          .lastSuccessfulPlayerIndex,

      consecutivePasses:
        room.state
          .consecutivePasses,

      finishOrder:
        [
          ...room.state
            .finishOrder,
        ],

      hasStarted:
        room.state
          .hasStarted,

      paused:
        room.state
          .paused,

      phase:
        room.state
          .phase,

      turnLockedUntil:
        room.state
          .turnLockedUntil,

      revision:
        room.state
          .revision,

      gameId:
        room.state
          .gameId,

      dealtAt:
        room.state
          .dealtAt,
    },
  };
}

function emitRoomState(
  room,
  eventName =
    'roomStateUpdate'
) {
  room.players.forEach(
    (
      player,
      seatIndex
    ) => {
      if (
        !player.socketId
      ) {
        return;
      }

      const clientState =
        buildClientRoomState(
          room,
          seatIndex
        );

      io
        .to(
          player.socketId
        )
        .emit(
          eventName,
          clientState
        );
    }
  );
}

/* =========================================================
   DESTROY ROOM
   ========================================================= */

function destroyRoom(
  room,
  reason
) {
  if (
    room.advanceTimer
  ) {
    clearTimeout(
      room.advanceTimer
    );

    room.advanceTimer =
      null;
  }

  if (
    room.state.gameId
  ) {
    appendGameEvent(
      room,
      'room_closed',
      {
        reason,
      }
    );

    finalizeGameLog(
      room,
      'aborted',
      reason
    );
  }

  io
    .to(
      room.code
    )
    .emit(
      'roomClosed',
      {
        reason,
      }
    );

  io
    .in(
      room.code
    )
    .socketsLeave(
      room.code
    );

  rooms.delete(
    room.code
  );
}

/* =========================================================
   TWO-SECOND PLAY DISPLAY
   ========================================================= */

function scheduleAdvanceAfterPlay(
  room,
  playerSeatIndex
) {
  if (
    room.advanceTimer
  ) {
    clearTimeout(
      room.advanceTimer
    );
  }

  const gameId =
    room.state.gameId;

  room.advanceTimer =
    setTimeout(
      () => {
        const currentRoom =
          rooms.get(
            room.code
          );

        if (
          !currentRoom ||
          currentRoom.state
            .gameId !==
            gameId
        ) {
          return;
        }

        currentRoom.advanceTimer =
          null;

        currentRoom.state
          .turnLockedUntil =
          null;

        if (
          getActivePlayerCount(
            currentRoom
          ) <= 1
        ) {
          currentRoom.state
            .hasStarted =
            false;

          currentRoom.state
            .phase =
            'finished';

          appendGameEvent(
            currentRoom,
            'game_finished',
            {
              reason:
                'one_player_remaining',
            }
          );

          finalizeGameLog(
            currentRoom,
            'completed',
            'one_player_remaining'
          );

          touchRoom(
            currentRoom
          );

          emitRoomState(
            currentRoom,
            'gameStateUpdate'
          );

          io
            .to(
              currentRoom.code
            )
            .emit(
              'toast',
              'Game finished.'
            );

          return;
        }

        const nextPlayerIndex =
          findNextActivePlayerIndex(
            currentRoom,
            playerSeatIndex
          );

        if (
          nextPlayerIndex ===
          null
        ) {
          currentRoom.state
            .hasStarted =
            false;

          currentRoom.state
            .phase =
            'finished';

          finalizeGameLog(
            currentRoom,
            'completed',
            'no_active_next_player'
          );

          touchRoom(
            currentRoom
          );

          emitRoomState(
            currentRoom,
            'gameStateUpdate'
          );

          return;
        }

        currentRoom.state
          .currentPlayerIndex =
          nextPlayerIndex;

        currentRoom.state
          .phase =
          'turn';

        appendGameEvent(
          currentRoom,
          'turn_advance',
          {
            fromPlayerId:
              currentRoom
                .players[
                  playerSeatIndex
                ].id,

            toPlayerId:
              currentRoom
                .players[
                  nextPlayerIndex
                ].id,
          }
        );

        touchRoom(
          currentRoom
        );

        emitRoomState(
          currentRoom,
          'gameStateUpdate'
        );
      },

      2000
    );
}

/* =========================================================
   SOCKET CONNECTION
   ========================================================= */

io.on(
  'connection',
  (socket) => {
    let currentRoomCode =
      null;

    let playerSeatIndex =
      null;

    /* =====================================================
       CREATE ROOM
       ===================================================== */

    socket.on(
      'createRoom',

      (
        { name } = {},

        callback =
          () => {}
      ) => {
        const roomCode =
          generateRoomCode();

        const cleanName =
          typeof name ===
          'string'
            ? name
                .trim()
                .slice(
                  0,
                  24
                )
            : '';

        const room =
          createEmptyRoom(
            roomCode,
            cleanName,
            socket.id
          );

        rooms.set(
          roomCode,
          room
        );

        currentRoomCode =
          roomCode;

        playerSeatIndex =
          0;

        socket.join(
          roomCode
        );

        touchRoom(
          room
        );

        callback({
          success:
            true,

          roomCode,

          seatIndex:
            0,
        });

        emitRoomState(
          room
        );
      }
    );

    /* =====================================================
       JOIN ROOM
       ===================================================== */

    socket.on(
      'joinRoom',

      (
        {
          roomCode,
          seatIndex,
          name,
        } = {},

        callback =
          () => {}
      ) => {
        const code =
          String(
            roomCode ??
            ''
          )
            .trim()
            .toUpperCase();

        const parsedSeatIndex =
          Number(
            seatIndex
          );

        const room =
          rooms.get(
            code
          );

        if (!room) {
          callback({
            success:
              false,

            message:
              'Room not found.',
          });

          return;
        }

        if (
          !Number
            .isInteger(
              parsedSeatIndex
            ) ||
          parsedSeatIndex <
            1 ||
          parsedSeatIndex >
            5
        ) {
          callback({
            success:
              false,

            message:
              'Choose Player 2 to Player 6.',
          });

          return;
        }

        const seat =
          room.players[
            parsedSeatIndex
          ];

        if (
          seat.socketId
        ) {
          callback({
            success:
              false,

            message:
              'That seat is already occupied.',
          });

          return;
        }

        const cleanName =
          typeof name ===
          'string'
            ? name
                .trim()
                .slice(
                  0,
                  24
                )
            : '';

        if (cleanName) {
          seat.name =
            cleanName;
        } else if (
          seat.name ===
          'Empty'
        ) {
          seat.name =
            `Player ${
              parsedSeatIndex +
              1
            }`;
        }

        seat.socketId =
          socket.id;

        currentRoomCode =
          code;

        playerSeatIndex =
          parsedSeatIndex;

        socket.join(
          code
        );

        if (
          room.state
            .hasStarted &&
          getConnectedPlayerCount(
            room
          ) === 6
        ) {
          room.state.paused =
            false;

          appendGameEvent(
            room,
            'game_resumed',
            {
              rejoinedPlayerId:
                seat.id,
            }
          );
        } else if (
          room.state
            .gameId
        ) {
          appendGameEvent(
            room,
            'player_rejoined',
            {
              playerId:
                seat.id,
            }
          );
        }

        touchRoom(
          room
        );

        callback({
          success:
            true,

          roomCode:
            code,

          seatIndex:
            parsedSeatIndex,
        });

        emitRoomState(
          room
        );
      }
    );

    /* =====================================================
       DEAL
       ===================================================== */

    socket.on(
      'dealCards',

      (
        callback =
          () => {}
      ) => {
        if (
          !currentRoomCode ||
          playerSeatIndex !==
            0
        ) {
          callback({
            success:
              false,

            message:
              'Only Player 1 can deal.',
          });

          return;
        }

        const room =
          rooms.get(
            currentRoomCode
          );

        if (!room) {
          callback({
            success:
              false,

            message:
              'Room not found.',
          });

          return;
        }

        if (
          getConnectedPlayerCount(
            room
          ) !== 6
        ) {
          callback({
            success:
              false,

            message:
              'All 6 players must be connected before dealing.',
          });

          return;
        }

        if (
          room.state
            .gameId &&
          room.state
            .hasStarted
        ) {
          appendGameEvent(
            room,
            'game_aborted',
            {
              reason:
                'host_redeal',
            }
          );

          finalizeGameLog(
            room,
            'aborted',
            'host_redeal'
          );
        }

        if (
          room.advanceTimer
        ) {
          clearTimeout(
            room.advanceTimer
          );

          room.advanceTimer =
            null;
        }

        const newDeal =
          createNewDeal();

        room.state.hands =
          newDeal.hands.map(
            (hand) =>
              sortCards(
                hand
              )
          );

        room.state
          .currentPlayerIndex =
          0;

        room.state
          .currentLead =
          null;

        room.state
          .lastSuccessfulPlayerIndex =
          null;

        room.state
          .consecutivePasses =
          0;

        room.state
          .finishOrder =
          [];

        room.state
          .hasStarted =
          true;

        room.state
          .paused =
          false;

        room.state
          .phase =
          'turn';

        room.state
          .turnLockedUntil =
          null;

        room.players.forEach(
          (player) => {
            player.hasFinished =
              false;
          }
        );

        createGameLog(
          room
        );

        touchRoom(
          room
        );

        callback({
          success:
            true,

          gameId:
            room.state
              .gameId,

          dealtAt:
            room.state
              .dealtAt,
        });

        emitRoomState(
          room,
          'gameStateUpdate'
        );
      }
    );

    /* =====================================================
       PLAY CARDS
       ===================================================== */

    socket.on(
      'playCards',

      (
        {
          cardIds,
        } = {},

        callback =
          () => {}
      ) => {
        const room =
          rooms.get(
            currentRoomCode
          );

        if (
          !room ||
          !room.state
            .hasStarted
        ) {
          callback({
            success:
              false,

            message:
              'No active game.',
          });

          return;
        }

        if (
          room.state.paused
        ) {
          callback({
            success:
              false,

            message:
              'Game is paused because a player is disconnected.',
          });

          return;
        }

        if (
          room.state.phase !==
          'turn'
        ) {
          callback({
            success:
              false,

            message:
              'Wait for the current play to finish displaying.',
          });

          return;
        }

        if (
          room.state
            .currentPlayerIndex !==
          playerSeatIndex
        ) {
          callback({
            success:
              false,

            message:
              "It's not your turn.",
          });

          return;
        }

        if (
          !Array.isArray(
            cardIds
          ) ||
          cardIds.length ===
            0
        ) {
          callback({
            success:
              false,

            message:
              'Select at least one card.',
          });

          return;
        }

        const uniqueCardIds =
          [
            ...new Set(
              cardIds
            ),
          ];

        const currentHand =
          room.state.hands[
            playerSeatIndex
          ];

        const selectedCards =
          currentHand.filter(
            (card) =>
              uniqueCardIds
                .includes(
                  card.id
                )
          );

        if (
          selectedCards.length !==
          uniqueCardIds.length
        ) {
          callback({
            success:
              false,

            message:
              'One or more selected cards are not in your hand.',
          });

          return;
        }

        const validation =
          validatePlay(
            selectedCards,

            room.state
              .trumpRank,

            room.state
              .currentLead
              ?.combination ??
              null
          );

        if (
          !validation.valid
        ) {
          callback({
            success:
              false,

            message:
              validation.reason,
          });

          return;
        }

        const handCountBefore =
          currentHand.length;

        room.state.hands[
          playerSeatIndex
        ] =
          currentHand.filter(
            (card) =>
              !uniqueCardIds
                .includes(
                  card.id
                )
          );

        const handCountAfter =
          room.state.hands[
            playerSeatIndex
          ].length;

        room.state.currentLead =
          {
            playerIndex:
              playerSeatIndex,

            combination:
              validation
                .combination,

            cards:
              selectedCards,
          };

        room.state
          .lastSuccessfulPlayerIndex =
          playerSeatIndex;

        room.state
          .consecutivePasses =
          0;

        let finished =
          false;

        if (
          handCountAfter ===
          0
        ) {
          finished =
            true;

          room.players[
            playerSeatIndex
          ].hasFinished =
            true;

          const playerId =
            room.players[
              playerSeatIndex
            ].id;

          if (
            !room.state
              .finishOrder
              .includes(
                playerId
              )
          ) {
            room.state
              .finishOrder
              .push(
                playerId
              );
          }
        }

        room.state.phase =
          'showing-play';

        room.state
          .turnLockedUntil =
          Date.now() +
          2000;

        appendGameEvent(
          room,
          'play',
          {
            playerId:
              room.players[
                playerSeatIndex
              ].id,

            seatIndex:
              playerSeatIndex,

            team:
              room.players[
                playerSeatIndex
              ].team,

            cards:
              selectedCards.map(
                serializeCard
              ),

            combination:
              serializeCombination(
                validation
                  .combination
              ),

            handCountBefore,

            handCountAfter,

            finished,

            currentFinishOrder:
              [
                ...room.state
                  .finishOrder,
              ],
          }
        );

        touchRoom(
          room
        );

        callback({
          success:
            true,
        });

        emitRoomState(
          room,
          'gameStateUpdate'
        );

        scheduleAdvanceAfterPlay(
          room,
          playerSeatIndex
        );
      }
    );

    /* =====================================================
       PASS
       ===================================================== */

    socket.on(
      'passTurn',

      (
        callback =
          () => {}
      ) => {
        const room =
          rooms.get(
            currentRoomCode
          );

        if (
          !room ||
          !room.state
            .hasStarted
        ) {
          callback({
            success:
              false,

            message:
              'No active game.',
          });

          return;
        }

        if (
          room.state.paused
        ) {
          callback({
            success:
              false,

            message:
              'Game is paused because a player is disconnected.',
          });

          return;
        }

        if (
          room.state.phase !==
          'turn'
        ) {
          callback({
            success:
              false,

            message:
              'Wait for the current play to finish displaying.',
          });

          return;
        }

        if (
          room.state
            .currentPlayerIndex !==
          playerSeatIndex
        ) {
          callback({
            success:
              false,

            message:
              "It's not your turn.",
          });

          return;
        }

        if (
          !room.state
            .currentLead
        ) {
          callback({
            success:
              false,

            message:
              'The leading player cannot pass.',
          });

          return;
        }

        const leadBeforePass =
          {
            playerIndex:
              room.state
                .currentLead
                .playerIndex,

            combination:
              serializeCombination(
                room.state
                  .currentLead
                  .combination
              ),

            cards:
              room.state
                .currentLead
                .cards
                .map(
                  serializeCard
                ),
          };

        room.state
          .consecutivePasses +=
          1;

        const passesNeeded =
          getPassesNeeded(
            room
          );

        let trickEnded =
          false;

        let nextPlayerIndex =
          null;

        if (
          room.state
            .consecutivePasses >=
          passesNeeded
        ) {
          trickEnded =
            true;

          const previousLeader =
            room.state
              .lastSuccessfulPlayerIndex;

          room.state
            .currentLead =
            null;

          room.state
            .consecutivePasses =
            0;

          if (
            previousLeader !==
              null &&
            room.players[
              previousLeader
            ].socketId &&
            !room.players[
              previousLeader
            ].hasFinished
          ) {
            nextPlayerIndex =
              previousLeader;
          } else {
            nextPlayerIndex =
              findNextActivePlayerIndex(
                room,

                previousLeader ??
                  playerSeatIndex
              );
          }
        } else {
          nextPlayerIndex =
            findNextActivePlayerIndex(
              room,
              playerSeatIndex
            );
        }

        if (
          nextPlayerIndex ===
          null
        ) {
          room.state
            .hasStarted =
            false;

          room.state.phase =
            'finished';
        } else {
          room.state
            .currentPlayerIndex =
            nextPlayerIndex;

          room.state.phase =
            'turn';
        }

        appendGameEvent(
          room,
          'pass',
          {
            playerId:
              room.players[
                playerSeatIndex
              ].id,

            seatIndex:
              playerSeatIndex,

            passSource:
              'manual',

            leadAtPass:
              leadBeforePass,

            trickEnded,

            nextPlayerId:
              nextPlayerIndex ===
              null
                ? null
                : room.players[
                    nextPlayerIndex
                  ].id,
          }
        );

        if (
          !room.state
            .hasStarted
        ) {
          finalizeGameLog(
            room,
            'completed',
            'no_active_next_player'
          );
        }

        touchRoom(
          room
        );

        callback({
          success:
            true,
        });

        emitRoomState(
          room,
          'gameStateUpdate'
        );
      }
    );

    /* =====================================================
       DISCONNECT
       ===================================================== */

    socket.on(
      'disconnect',

      () => {
        if (
          !currentRoomCode ||
          playerSeatIndex ===
            null
        ) {
          return;
        }

        const room =
          rooms.get(
            currentRoomCode
          );

        if (!room) {
          return;
        }

        /*
          HOST LEFT:
          destroy whole room.
        */
        if (
          playerSeatIndex ===
          0
        ) {
          destroyRoom(
            room,
            'host_disconnected'
          );

          return;
        }

        const player =
          room.players[
            playerSeatIndex
          ];

        player.socketId =
          null;

        if (
          room.state
            .hasStarted
        ) {
          room.state.paused =
            true;

          appendGameEvent(
            room,
            'player_disconnected',
            {
              playerId:
                player.id,

              seatIndex:
                playerSeatIndex,
            }
          );

          io
            .to(
              room.code
            )
            .emit(
              'toast',

              `${player.name} disconnected. Game paused.`
            );
        }

        touchRoom(
          room
        );

        emitRoomState(
          room
        );
      }
    );
  }
);

/* =========================================================
   START SERVER
   ========================================================= */

await initializeHistory();

const PORT =
  Number(
    process.env.PORT
  ) || 3000;

httpServer.listen(
  PORT,
  '0.0.0.0',

  () => {
    console.log(
      `Daguai Luzi server running on port ${PORT}`
    );

    console.log(
      `Local game history: ${historyFile}`
    );

    console.log(
      githubSyncEnabled
        ? `GitHub history sync enabled: ${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_HISTORY_PATH}`
        : 'GitHub history sync is disabled.'
    );
  }
);
