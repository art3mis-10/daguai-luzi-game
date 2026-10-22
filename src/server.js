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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicDir = path.join(__dirname, 'public');
const gameDir = path.join(__dirname, 'game');
const dataDir = path.join(__dirname, '..', 'data');
const historyFile = path.join(
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
  'daguai-luzi-game';

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
   HISTORY DIAGNOSTICS
   ========================================================= */

const historyDiagnostics = {
  lastLocalSave: null,
  lastGitHubSyncAttempt: null,
  lastGitHubSync: null,
  lastGitHubSyncSuccess: null,
  lastGitHubError: null,
};

/* =========================================================
   LOCAL HISTORY
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
    schemaVersion: 3,
    lastUpdatedAt: null,
    games: [],
  };
}

function loadLocalHistory() {
  if (!existsSync(historyFile)) {
    return createEmptyHistory();
  }

  try {
    const raw = readFileSync(
      historyFile,
      'utf8'
    );

    const parsed = JSON.parse(raw);

    if (
      !parsed ||
      !Array.isArray(parsed.games)
    ) {
      return createEmptyHistory();
    }

    parsed.schemaVersion =
      Math.max(
        Number(parsed.schemaVersion) || 1,
        3
      );

    if (
      !Object.prototype.hasOwnProperty.call(
        parsed,
        'lastUpdatedAt'
      )
    ) {
      parsed.lastUpdatedAt = null;
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

function writeLocalHistory(history) {
  writeFileSync(
    historyFile,
    JSON.stringify(
      history,
      null,
      2
    ),
    'utf8'
  );

  historyDiagnostics.lastLocalSave =
    new Date().toISOString();
}

/* =========================================================
   GITHUB HISTORY API
   ========================================================= */

function getGitHubReadUrl() {
  return (
    `https://api.github.com/repos/` +
    `${encodeURIComponent(GITHUB_OWNER)}/` +
    `${encodeURIComponent(GITHUB_REPO)}/` +
    `contents/${GITHUB_HISTORY_PATH}` +
    `?ref=${encodeURIComponent(GITHUB_BRANCH)}`
  );
}

function getGitHubWriteUrl() {
  return (
    `https://api.github.com/repos/` +
    `${encodeURIComponent(GITHUB_OWNER)}/` +
    `${encodeURIComponent(GITHUB_REPO)}/` +
    `contents/${GITHUB_HISTORY_PATH}`
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
      'daguai-luzi-game-server',
  };
}

async function readHistoryFromGitHub() {
  if (!githubSyncEnabled) {
    return null;
  }

  const response =
    await fetch(
      getGitHubReadUrl(),
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
      .toString('utf8');

  const parsed =
    JSON.parse(decoded);

  if (
    !parsed ||
    !Array.isArray(parsed.games)
  ) {
    return null;
  }

  parsed.schemaVersion =
    Math.max(
      Number(parsed.schemaVersion) || 1,
      3
    );

  return parsed;
}

async function pushHistoryToGitHub(
  historySnapshot
) {
  let sha = null;

  const existingResponse =
    await fetch(
      getGitHubReadUrl(),
      {
        headers:
          getGitHubHeaders(),
      }
    );

  if (existingResponse.ok) {
    const existing =
      await existingResponse.json();

    sha = existing.sha;
  } else if (
    existingResponse.status !== 404
  ) {
    const text =
      await existingResponse.text();

    throw new Error(
      `GitHub read-before-write failed: ` +
      `${existingResponse.status} ${text}`
    );
  }

  const jsonText =
    JSON.stringify(
      historySnapshot,
      null,
      2
    );

  const content =
    Buffer
      .from(
        jsonText,
        'utf8'
      )
      .toString('base64');

  const body = {
    message:
      `Update Daguai game history ` +
      new Date().toISOString(),

    content,

    branch:
      GITHUB_BRANCH,
  };

  if (sha) {
    body.sha = sha;
  }

  const response =
    await fetch(
      getGitHubWriteUrl(),
      {
        method: 'PUT',

        headers: {
          ...getGitHubHeaders(),

          'Content-Type':
            'application/json',
        },

        body:
          JSON.stringify(body),
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
}

let githubSyncChain =
  Promise.resolve();

let syncTimer = null;

async function performGitHubSync(
  historySnapshot
) {
  if (!githubSyncEnabled) {
    return true;
  }

  historyDiagnostics
    .lastGitHubSyncAttempt =
    new Date().toISOString();

  try {
    await pushHistoryToGitHub(
      historySnapshot
    );

    historyDiagnostics
      .lastGitHubSync =
      new Date().toISOString();

    historyDiagnostics
      .lastGitHubSyncSuccess =
      true;

    historyDiagnostics
      .lastGitHubError =
      null;

    console.log(
      'Game history synced to GitHub.'
    );

    return true;
  } catch (error) {
    historyDiagnostics
      .lastGitHubSyncSuccess =
      false;

    historyDiagnostics
      .lastGitHubError =
      error.message;

    console.error(
      'Could not sync history to GitHub:',
      error
    );

    return false;
  }
}

function enqueueGitHubSync(
  historySnapshot
) {
  githubSyncChain =
    githubSyncChain
      .then(
        () =>
          performGitHubSync(
            historySnapshot
          )
      )
      .catch(
        (error) => {
          historyDiagnostics
            .lastGitHubSyncSuccess =
            false;

          historyDiagnostics
            .lastGitHubError =
            error.message;

          console.error(
            'GitHub sync queue error:',
            error
          );

          return false;
        }
      );

  return githubSyncChain;
}

function queueGitHubSync() {
  if (!githubSyncEnabled) {
    return;
  }

  clearTimeout(syncTimer);

  syncTimer =
    setTimeout(
      () => {
        syncTimer = null;

        const snapshot =
          JSON.parse(
            JSON.stringify(
              gameHistory
            )
          );

        enqueueGitHubSync(
          snapshot
        );
      },
      700
    );
}

async function saveHistory(
  {
    immediateGitHub = false,
  } = {}
) {
  gameHistory.schemaVersion = 3;

  gameHistory.lastUpdatedAt =
    new Date().toISOString();

  writeLocalHistory(
    gameHistory
  );

  if (!githubSyncEnabled) {
    return true;
  }

  if (!immediateGitHub) {
    queueGitHubSync();

    return true;
  }

  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }

  const snapshot =
    JSON.parse(
      JSON.stringify(
        gameHistory
      )
    );

  return enqueueGitHubSync(
    snapshot
  );
}

/* =========================================================
   HISTORY INITIALIZATION
   ========================================================= */

let gameHistory =
  loadLocalHistory();

async function initializeHistory() {
  if (!githubSyncEnabled) {
    writeLocalHistory(
      gameHistory
    );

    console.log(
      'GitHub history sync disabled.'
    );

    return;
  }

  try {
    const remote =
      await readHistoryFromGitHub();

    if (remote) {
      gameHistory = remote;

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

      await saveHistory({
        immediateGitHub: true,
      });
    }
  } catch (error) {
    historyDiagnostics
      .lastGitHubSyncSuccess =
      false;

    historyDiagnostics
      .lastGitHubError =
      error.message;

    console.error(
      'Could not initialize history from GitHub:',
      error
    );

    writeLocalHistory(
      gameHistory
    );
  }
}

/* =========================================================
   EXPRESS / SOCKET.IO
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
   HISTORY STATUS DEBUG ENDPOINT
   ========================================================= */

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

      lastLocalSave:
        historyDiagnostics
          .lastLocalSave,

      lastGitHubSyncAttempt:
        historyDiagnostics
          .lastGitHubSyncAttempt,

      lastGitHubSync:
        historyDiagnostics
          .lastGitHubSync,

      lastGitHubSyncSuccess:
        historyDiagnostics
          .lastGitHubSyncSuccess,

      lastGitHubError:
        historyDiagnostics
          .lastGitHubError,

      githubRepository:
        `${GITHUB_OWNER}/${GITHUB_REPO}`,

      githubBranch:
        GITHUB_BRANCH,

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
  return new Date().toISOString();
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
      combination
        .wildAssignments ??
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
    room.state
      .currentLead
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

  const activeCount =
    getActivePlayerCount(
      room
    );

  return Math.max(
    1,

    activeCount -
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
   STARTING PLAYER RULE

   FIRST GAME:
   Compare number of:
   ♠3 -> ♠4 -> ♠5 -> ... -> ♠A -> ♠2

   Only players tied at the previous step
   continue to the next comparison.

   LATER GAMES:
   Previous first-out player (头家) starts.
   ========================================================= */

const FIRST_GAME_SPADE_RANK_ORDER =
  [
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    '10',
    'J',
    'Q',
    'K',
    'A',
    '2',
  ];

function normalizeRank(
  rank
) {
  return String(
    rank ?? ''
  )
    .trim()
    .toUpperCase();
}

function isSpade(
  card
) {
  const suit =
    String(
      card?.suit ?? ''
    )
      .trim()
      .toLowerCase();

  const symbol =
    String(
      card?.symbol ?? ''
    ).trim();

  return (
    suit === 'spades' ||
    suit === 'spade' ||
    suit === 's' ||
    symbol === '♠'
  );
}

function countSpadeRank(
  hand,
  rank
) {
  const normalizedTarget =
    normalizeRank(rank);

  return (
    hand.filter(
      (card) =>
        isSpade(card) &&
        normalizeRank(
          card.rank
        ) ===
          normalizedTarget
    ).length
  );
}

function determineFirstGameStarter(
  hands
) {
  let candidates =
    [0, 1, 2, 3, 4, 5];

  const comparison = [];

  for (
    const rank of
    FIRST_GAME_SPADE_RANK_ORDER
  ) {
    const counts =
      hands.map(
        (hand) =>
          countSpadeRank(
            hand,
            rank
          )
      );

    const candidateCounts =
      candidates.map(
        (seatIndex) =>
          counts[
            seatIndex
          ]
      );

    const maxCount =
      Math.max(
        ...candidateCounts
      );

    const beforeCandidates =
      [
        ...candidates,
      ];

    candidates =
      candidates.filter(
        (seatIndex) =>
          counts[
            seatIndex
          ] ===
          maxCount
      );

    comparison.push({
      rank,

      countsBySeat:
        counts,

      candidateSeatsBefore:
        beforeCandidates,

      maxCount,

      candidateSeatsAfter:
        [
          ...candidates,
        ],
    });

    if (
      candidates.length === 1
    ) {
      break;
    }
  }

  /*
    The real card comparison
    should almost always resolve it.

    If every compared spade count
    is still identical, use the
    lower seat number so the server
    always has a deterministic result.
  */
  const startingPlayerIndex =
    candidates[0];

  return {
    startingPlayerIndex,

    method:
      'first_game_spade_tiebreak',

    comparison,

    fallbackUsed:
      candidates.length > 1,
  };
}

function determineRandomDealStarter(
  room,
  hands
) {
  /*
    Once a head player has been
    determined, they start every
    following game.
  */
  if (
    Number.isInteger(
      room.previousHeadPlayerIndex
    )
  ) {
    return {
      startingPlayerIndex:
        room.previousHeadPlayerIndex,

      method:
        'previous_head_player',

      previousHeadPlayerId:
        room.players[
          room.previousHeadPlayerIndex
        ].id,

      comparison: [],

      fallbackUsed:
        false,
    };
  }

  return determineFirstGameStarter(
    hands
  );
}

/* =========================================================
   CUSTOM DEAL PARSING
   ========================================================= */

function createFullPhysicalCardPool() {
  const freshDeal =
    createNewDeal();

  if (
    !freshDeal ||
    !Array.isArray(
      freshDeal.hands
    )
  ) {
    throw new Error(
      'createNewDeal() did not return a valid hands array.'
    );
  }

  /*
    A normal deal contains all 162
    physical cards, so flattening it
    gives us a complete physical pool.
  */
  return freshDeal.hands.flat();
}

function normalizeCardToken(
  rawToken
) {
  let token =
    String(rawToken)
      .trim()
      .toUpperCase();

  token =
    token
      .replaceAll(
        '♠',
        'S'
      )
      .replaceAll(
        '♥',
        'H'
      )
      .replaceAll(
        '♣',
        'C'
      )
      .replaceAll(
        '♦',
        'D'
      )
      .replaceAll(
        '-',
        ''
      )
      .replaceAll(
        '_',
        ''
      );

  if (
    token === 'BIGJOKER' ||
    token === 'BIG' ||
    token === '大怪'
  ) {
    return 'BJ';
  }

  if (
    token ===
      'SMALLJOKER' ||
    token === 'SMALL' ||
    token === '小怪'
  ) {
    return 'SJ';
  }

  return token;
}

function tokenizeHandText(
  text
) {
  const normalized =
    String(
      text ?? ''
    )
      .replace(
        /BIG\s+JOKER/gi,
        'BJ'
      )
      .replace(
        /SMALL\s+JOKER/gi,
        'SJ'
      )
      .replace(
        /[,;\n\r\t]+/g,
        ' '
      );

  return (
    normalized
      .split(/\s+/)
      .map(
        normalizeCardToken
      )
      .filter(Boolean)
  );
}

function parseCardToken(
  token
) {
  if (token === 'BJ') {
    return {
      kind:
        'big-joker',
    };
  }

  if (token === 'SJ') {
    return {
      kind:
        'small-joker',
    };
  }

  let match =
    token.match(
      /^(10|[2-9JQKA])([SHCD])$/
    );

  if (match) {
    return {
      kind:
        'ordinary',

      rank:
        match[1],

      suitCode:
        match[2],
    };
  }

  match =
    token.match(
      /^([SHCD])(10|[2-9JQKA])$/
    );

  if (match) {
    return {
      kind:
        'ordinary',

      rank:
        match[2],

      suitCode:
        match[1],
    };
  }

  throw new Error(
    `Invalid card token "${token}". ` +
    `Use AS, 10H, QC, BJ, or SJ.`
  );
}

function suitCodeToName(
  suitCode
) {
  const suits = {
    S: 'spades',
    H: 'hearts',
    C: 'clubs',
    D: 'diamonds',
  };

  return suits[
    suitCode
  ];
}

function jokerText(
  card
) {
  return [
    card?.rank,
    card?.displayRank,
    card?.jokerType,
    card?.id,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function isBigJokerCard(
  card
) {
  if (
    !card?.isJoker
  ) {
    return false;
  }

  const text =
    jokerText(card);

  return (
    text.includes('big') ||
    text.includes('大怪') ||
    text.includes('bj')
  );
}

function isSmallJokerCard(
  card
) {
  if (
    !card?.isJoker
  ) {
    return false;
  }

  const text =
    jokerText(card);

  return (
    text.includes(
      'small'
    ) ||
    text.includes('小怪') ||
    text.includes('sj')
  );
}

function cardMatchesRequest(
  card,
  request
) {
  if (
    request.kind ===
    'big-joker'
  ) {
    return isBigJokerCard(
      card
    );
  }

  if (
    request.kind ===
    'small-joker'
  ) {
    return isSmallJokerCard(
      card
    );
  }

  return (
    normalizeRank(
      card.rank
    ) ===
      normalizeRank(
        request.rank
      ) &&
    String(
      card.suit ?? ''
    ).toLowerCase() ===
      suitCodeToName(
        request.suitCode
      )
  );
}

function buildCustomHands(
  handTexts
) {
  if (
    !Array.isArray(
      handTexts
    ) ||
    handTexts.length !== 6
  ) {
    throw new Error(
      'Custom deal must contain exactly 6 player hands.'
    );
  }

  const fullDeck =
    createFullPhysicalCardPool();

  const usedCardIds =
    new Set();

  const hands =
    Array.from(
      {
        length: 6,
      },
      () => []
    );

  for (
    let seatIndex = 0;
    seatIndex < 6;
    seatIndex += 1
  ) {
    const tokens =
      tokenizeHandText(
        handTexts[
          seatIndex
        ]
      );

    for (
      const token of tokens
    ) {
      const request =
        parseCardToken(
          token
        );

      const card =
        fullDeck.find(
          (candidate) =>
            !usedCardIds.has(
              candidate.id
            ) &&
            cardMatchesRequest(
              candidate,
              request
            )
        );

      if (!card) {
        throw new Error(
          `Player ${seatIndex + 1}: ` +
          `"${token}" is unavailable. ` +
          `You may have used more copies than exist in the three decks.`
        );
      }

      usedCardIds.add(
        card.id
      );

      hands[
        seatIndex
      ].push(
        card
      );
    }
  }

  const sortedHands =
    hands.map(
      (hand) =>
        sortCards(
          hand
        )
    );

  const unassignedCards =
    fullDeck.filter(
      (card) =>
        !usedCardIds.has(
          card.id
        )
    );

  return {
    hands:
      sortedHands,

    unassignedCards,
  };
}

function parseFinishOrder(
  rawValue
) {
  const text =
    String(
      rawValue ?? ''
    ).trim();

  if (!text) {
    return [];
  }

  const values =
    text
      .split(
        /[\s,;]+/
      )
      .filter(Boolean)
      .map(
        (value) =>
          Number(value)
      );

  for (
    const playerId of
    values
  ) {
    if (
      !Number.isInteger(
        playerId
      ) ||
      playerId < 1 ||
      playerId > 6
    ) {
      throw new Error(
        'Finished order must only contain player numbers 1 to 6.'
      );
    }
  }

  if (
    new Set(values)
      .size !==
    values.length
  ) {
    throw new Error(
      'A player cannot appear twice in the finished order.'
    );
  }

  return values;
}

/* =========================================================
   PUBLIC CARD COUNT REPORTS
   ========================================================= */

function createEmptyPublicReports() {
  return [
    null,
    null,
    null,
    null,
    null,
    null,
  ];
}

function makeReportedCount(
  count,
  askedByPlayerId = null
) {
  return {
    status:
      'reported',

    count,

    askedAt:
      nowIso(),

    askedByPlayerId,
  };
}

function updateKnownPublicCountAfterPlay(
  room,
  seatIndex,
  newCount
) {
  const existing =
    room.state
      .publicReports[
        seatIndex
      ];

  /*
    If the number was already
    public, everybody can subtract
    subsequently played cards.
  */
  if (
    existing?.status ===
    'reported'
  ) {
    room.state
      .publicReports[
        seatIndex
      ] = {
        ...existing,

        count:
          newCount,

        updatedAt:
          nowIso(),
      };
  }

  /*
    Finished = publicly 0 cards.
  */
  if (newCount === 0) {
    room.state
      .publicReports[
        seatIndex
      ] =
      makeReportedCount(
        0,

        existing
          ?.askedByPlayerId ??
          null
      );
  }
}

/* =========================================================
   GAME HISTORY HELPERS
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
  room,
  {
    dealSource,
    unassignedCards = [],
    startingPlayerInfo = null,
  }
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

  room.state.dealSource =
    dealSource;

  const gameLog = {
    gameId,

    roomCode:
      room.code,

    gameNumber:
      room.gameSequence,

    status:
      'ongoing',

    dealSource,

    dealtAt,

    dealtAtMinute:
      minuteIso(
        dealtAt
      ),

    trumpRank:
      room.state
        .trumpRank,

    startingPlayerId:
      room.players[
        room.state
          .currentPlayerIndex
      ].id,

    startingPlayerSeatIndex:
      room.state
        .currentPlayerIndex,

    startingPlayerMethod:
      startingPlayerInfo
        ?.method ??
      'unknown',

    startingPlayerComparison:
      startingPlayerInfo
        ?.comparison ??
      [],

    startingPlayerFallbackUsed:
      startingPlayerInfo
        ?.fallbackUsed ??
      false,

    previousHeadPlayerId:
      startingPlayerInfo
        ?.previousHeadPlayerId ??
      null,

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

    unassignedCards:
      unassignedCards.map(
        serializeCard
      ),

    startingFinishOrder:
      [
        ...room.state
          .finishOrder,
      ],

    events: [],

    headPlayerId:
      room.state
        .finishOrder[0] ??
      null,

    finishOrder:
      [
        ...room.state
          .finishOrder,
      ],

    endedAt:
      null,

    endedReason:
      null,

    finalHands:
      null,
  };

  gameHistory.games.push(
    gameLog
  );
}

function appendGameEvent(
  room,
  type,
  details = {},
  {
    persist = true,
  } = {}
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

  if (
    room.state
      .finishOrder
      .length > 0
  ) {
    gameLog.headPlayerId =
      room.state
        .finishOrder[0];
  }

  if (persist) {
    void saveHistory();
  }
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

  gameLog.headPlayerId =
    room.state
      .finishOrder[0] ??
    null;

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

  void saveHistory();
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

    /*
      null = this room has not
      established a 头家 yet.

      Once somebody becomes the
      first player out, their
      seat is stored here and they
      start the next game.
    */
    previousHeadPlayerIndex:
      null,

    gameSequence:
      0,

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

      dealSource:
        null,

      publicReports:
        createEmptyPublicReports(),

      customUnassignedCards:
        [],
    },
  };
}

/* =========================================================
   CLIENT SAFE STATE
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
        Only own private hand is
        sent to each browser.
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

      dealSource:
        room.state
          .dealSource,

      publicReports:
        room.state
          .publicReports
          .map(
            (report) =>
              report
                ? {
                    ...report,
                  }
                : null
          ),
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

      io
        .to(
          player.socketId
        )
        .emit(
          eventName,

          buildClientRoomState(
            room,
            seatIndex
          )
        );
    }
  );
}

/* =========================================================
   GAME SETUP
   ========================================================= */

function abortCurrentGameIfNeeded(
  room,
  reason
) {
  if (
    room.state.gameId &&
    room.state.hasStarted
  ) {
    appendGameEvent(
      room,
      'game_aborted',
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

  if (
    room.advanceTimer
  ) {
    clearTimeout(
      room.advanceTimer
    );

    room.advanceTimer =
      null;
  }
}

async function startGameWithHands(
  room,
  {
    hands,
    trumpRank,
    startingPlayerIndex,
    finishOrder,
    dealSource,
    unassignedCards = [],
    startingPlayerInfo = null,
  }
) {
  room.gameSequence += 1;

  room.state.hands =
    hands.map(
      (hand) =>
        sortCards(
          hand
        )
    );

  room.state.trumpRank =
    trumpRank;

  room.state.currentPlayerIndex =
    startingPlayerIndex;

  room.state.currentLead =
    null;

  room.state.lastSuccessfulPlayerIndex =
    null;

  room.state.consecutivePasses =
    0;

  room.state.finishOrder =
    [
      ...finishOrder,
    ];

  room.state.hasStarted =
    true;

  room.state.paused =
    false;

  room.state.phase =
    'turn';

  room.state.turnLockedUntil =
    null;

  room.state.publicReports =
    createEmptyPublicReports();

  room.state.customUnassignedCards =
    [
      ...unassignedCards,
    ];

  room.players.forEach(
    (
      player,
      seatIndex
    ) => {
      player.hasFinished =
        finishOrder.includes(
          player.id
        );

      if (
        player.hasFinished
      ) {
        room.state
          .publicReports[
            seatIndex
          ] =
          makeReportedCount(
            0,
            null
          );
      }
    }
  );

  /*
    If a custom checkpoint already
    contains a head player, that
    player becomes the next game's
    starting player.
  */
  if (
    finishOrder.length > 0
  ) {
    room.previousHeadPlayerIndex =
      finishOrder[0] - 1;
  }

  createGameLog(
    room,
    {
      dealSource,

      unassignedCards,

      startingPlayerInfo,
    }
  );

  appendGameEvent(
    room,
    'deal',
    {
      dealSource,

      dealtAt:
        room.state
          .dealtAt,

      trumpRank:
        room.state
          .trumpRank,

      startingPlayerId:
        room.players[
          room.state
            .currentPlayerIndex
        ].id,

      startingPlayerMethod:
        startingPlayerInfo
          ?.method ??
        'unknown',

      startingPlayerComparison:
        startingPlayerInfo
          ?.comparison ??
        [],

      initialFinishOrder:
        [
          ...room.state
            .finishOrder,
        ],

      unassignedCardCount:
        unassignedCards.length,
    },

    {
      persist:
        false,
    }
  );

  /*
    IMPORTANT:
    The initial game record is
    immediately written to GitHub.

    If GitHub sync fails, the game
    pauses rather than silently
    continuing without research data.
  */
  const persistenceOk =
    await saveHistory({
      immediateGitHub:
        true,
    });

  if (
    githubSyncEnabled &&
    !persistenceOk
  ) {
    room.state.paused =
      true;

    room.state.phase =
      'history-error';

    touchRoom(
      room
    );

    emitRoomState(
      room,
      'gameStateUpdate'
    );

    return {
      success:
        false,

      message:
        'The cards were created, but the game history could not be written to GitHub. The game has been paused to protect the research record. Check /api/history-status and Render logs.',
    };
  }

  touchRoom(
    room
  );

  emitRoomState(
    room,
    'gameStateUpdate'
  );

  return {
    success:
      true,

    gameId:
      room.state
        .gameId,

    dealtAt:
      room.state
        .dealtAt,
  };
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
   TWO SECOND PLAY DISPLAY
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
   SOCKETS
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
        {
          name,
        } = {},

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
       JOIN / REJOIN
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
          !Number.isInteger(
            parsedSeatIndex
          ) ||
          parsedSeatIndex < 1 ||
          parsedSeatIndex > 5
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
          room.state
            .phase !==
            'history-error' &&
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
          room.state.gameId
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
       RANDOM DEAL
       ===================================================== */

    socket.on(
      'dealCards',

      async (
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

        abortCurrentGameIfNeeded(
          room,
          'host_redeal'
        );

        const newDeal =
          createNewDeal();

        /*
          FIRST GAME:
          ♠3 -> ♠4 -> ♠5 ...

          FOLLOWING GAMES:
          previous 头家.
        */
        const startingPlayerInfo =
          determineRandomDealStarter(
            room,
            newDeal.hands
          );

        const result =
          await startGameWithHands(
            room,
            {
              hands:
                newDeal.hands,

              trumpRank:
                '2',

              startingPlayerIndex:
                startingPlayerInfo
                  .startingPlayerIndex,

              finishOrder:
                [],

              dealSource:
                'random',

              unassignedCards:
                [],

              startingPlayerInfo,
            }
          );

        callback(
          result
        );

        if (
          result.success
        ) {
          const starter =
            room.players[
              room.state
                .currentPlayerIndex
            ];

          io
            .to(
              room.code
            )
            .emit(
              'toast',

              startingPlayerInfo
                .method ===
              'previous_head_player'
                ? `${starter.name} starts because they were the previous head player.`
                : `${starter.name} starts based on the Spade 3, 4, 5... tie-break rule.`
            );
        }
      }
    );

    /* =====================================================
       CUSTOM DEAL
       ===================================================== */

    socket.on(
      'customDeal',

      async (
        {
          handTexts,
          trumpRank,
          startingPlayerIndex,
          finishOrderText,
        } = {},

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
              'Only Player 1 can create a custom deal.',
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
              'All 6 players must be connected before starting a custom game.',
          });

          return;
        }

        try {
          const allowedTrumpRanks =
            [
              '2',
              '3',
              '4',
              '5',
              '6',
              '7',
              '8',
              '9',
              '10',
              'J',
              'Q',
              'K',
              'A',
            ];

          const selectedTrumpRank =
            String(
              trumpRank ??
              '2'
            ).toUpperCase();

          if (
            !allowedTrumpRanks
              .includes(
                selectedTrumpRank
              )
          ) {
            throw new Error(
              'Invalid trump rank.'
            );
          }

          const startIndex =
            Number(
              startingPlayerIndex
            );

          if (
            !Number.isInteger(
              startIndex
            ) ||
            startIndex < 0 ||
            startIndex > 5
          ) {
            throw new Error(
              'Invalid starting player.'
            );
          }

          const finishOrder =
            parseFinishOrder(
              finishOrderText
            );

          const custom =
            buildCustomHands(
              handTexts
            );

          for (
            const playerId of
            finishOrder
          ) {
            const index =
              playerId - 1;

            if (
              custom.hands[
                index
              ].length !== 0
            ) {
              throw new Error(
                `Player ${playerId} is listed as finished but still has cards.`
              );
            }
          }

          for (
            let index = 0;
            index < 6;
            index += 1
          ) {
            const playerId =
              index + 1;

            const isFinished =
              finishOrder.includes(
                playerId
              );

            if (
              !isFinished &&
              custom.hands[
                index
              ].length === 0
            ) {
              throw new Error(
                `Player ${playerId} has no cards. ` +
                `If this player has already finished, add ${playerId} to Finished Order.`
              );
            }
          }

          if (
            finishOrder.includes(
              startIndex + 1
            )
          ) {
            throw new Error(
              'The starting player cannot already be finished.'
            );
          }

          const activeCount =
            6 -
            finishOrder.length;

          if (
            activeCount < 2
          ) {
            throw new Error(
              'A custom game must have at least two active players.'
            );
          }

          abortCurrentGameIfNeeded(
            room,
            'host_custom_redeal'
          );

          /*
            Custom Deal deliberately
            keeps manual starting player
            selection for research input.
          */
          const startingPlayerInfo = {
            startingPlayerIndex:
              startIndex,

            method:
              'custom_selected',

            comparison:
              [],

            fallbackUsed:
              false,
          };

          const result =
            await startGameWithHands(
              room,
              {
                hands:
                  custom.hands,

                trumpRank:
                  selectedTrumpRank,

                startingPlayerIndex:
                  startIndex,

                finishOrder,

                dealSource:
                  'custom',

                unassignedCards:
                  custom
                    .unassignedCards,

                startingPlayerInfo,
              }
            );

          if (
            !result.success
          ) {
            callback(
              result
            );

            return;
          }

          callback({
            ...result,

            unassignedCardCount:
              custom
                .unassignedCards
                .length,
          });
        } catch (error) {
          callback({
            success:
              false,

            message:
              error.message,
          });
        }
      }
    );

    /* =====================================================
       ASK CARD COUNT
       ===================================================== */

    socket.on(
      'askCardCount',

      (
        {
          targetSeatIndex,
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
          !room.state.gameId
        ) {
          callback({
            success:
              false,

            message:
              'No game has been dealt yet.',
          });

          return;
        }

        const targetIndex =
          Number(
            targetSeatIndex
          );

        if (
          !Number.isInteger(
            targetIndex
          ) ||
          targetIndex < 0 ||
          targetIndex > 5
        ) {
          callback({
            success:
              false,

            message:
              'Invalid player.',
          });

          return;
        }

        if (
          targetIndex ===
          playerSeatIndex
        ) {
          callback({
            success:
              false,

            message:
              'You already know your own card count.',
          });

          return;
        }

        const requester =
          room.players[
            playerSeatIndex
          ];

        const target =
          room.players[
            targetIndex
          ];

        const actualCount =
          room.state.hands[
            targetIndex
          ].length;

        const askedAt =
          nowIso();

        let publicResponse;

        if (
          actualCount <= 10
        ) {
          room.state
            .publicReports[
              targetIndex
            ] = {
              status:
                'reported',

              count:
                actualCount,

              askedAt,

              askedByPlayerId:
                requester.id,
            };

          publicResponse =
            `${actualCount} card${
              actualCount === 1
                ? ''
                : 's'
            }`;
        } else {
          room.state
            .publicReports[
              targetIndex
            ] = {
              status:
                'not-reported',

              count:
                null,

              askedAt,

              askedByPlayerId:
                requester.id,
            };

          publicResponse =
            'Not reported';
        }

        appendGameEvent(
          room,
          'ask_card_count',
          {
            requesterPlayerId:
              requester.id,

            requesterSeatIndex:
              playerSeatIndex,

            targetPlayerId:
              target.id,

            targetSeatIndex:
              targetIndex,

            actualCount,

            publicResponse:
              actualCount <= 10
                ? actualCount
                : 'not-reported',
          }
        );

        touchRoom(
          room
        );

        emitRoomState(
          room,
          'gameStateUpdate'
        );

        io
          .to(
            room.code
          )
          .emit(
            'publicMessage',

            `${requester.name} asked ${target.name}: ${publicResponse}`
          );

        callback({
          success:
            true,

          publicResponse:
            actualCount <= 10
              ? {
                  status:
                    'reported',

                  count:
                    actualCount,
                }
              : {
                  status:
                    'not-reported',

                  count:
                    null,
                },
        });
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
              room.state.phase ===
              'history-error'
                ? 'Game paused because history could not be written to GitHub.'
                : 'Game is paused because a player is disconnected.',
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
          cardIds.length === 0
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

        updateKnownPublicCountAfterPlay(
          room,
          playerSeatIndex,
          handCountAfter
        );

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

        let becameHeadPlayer =
          false;

        if (
          handCountAfter === 0
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
            /*
              First person who finishes
              becomes 头家.

              Store their seat so they
              start the next game.
            */
            if (
              room.state
                .finishOrder
                .length === 0
            ) {
              becameHeadPlayer =
                true;

              room.previousHeadPlayerIndex =
                playerSeatIndex;
            }

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

            becameHeadPlayer,

            currentFinishOrder:
              [
                ...room.state
                  .finishOrder,
              ],
          }
        );

        if (
          becameHeadPlayer
        ) {
          appendGameEvent(
            room,
            'head_player_determined',
            {
              playerId:
                room.players[
                  playerSeatIndex
                ].id,

              seatIndex:
                playerSeatIndex,

              nextGameStartingPlayerId:
                room.players[
                  playerSeatIndex
                ].id,
            }
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
              room.state.phase ===
              'history-error'
                ? 'Game paused because history could not be written to GitHub.'
                : 'Game is paused because a player is disconnected.',
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
          Host closes browser:
          room is destroyed.
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
      `Game history: ${historyFile}`
    );

    console.log(
      githubSyncEnabled
        ? `GitHub sync enabled: ${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_HISTORY_PATH}`
        : 'GitHub sync disabled.'
    );
  }
);
