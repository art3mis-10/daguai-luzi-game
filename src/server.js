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
  fileURLToPath(
    import.meta.url
  );

const __dirname =
  path.dirname(
    __filename
  );

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
  process.env.GITHUB_TOKEN ||
  '';

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
  process.env
    .GITHUB_HISTORY_PATH ||
  'data/game-history.json';

const githubSyncEnabled =
  Boolean(
    GITHUB_TOKEN &&
    GITHUB_OWNER &&
    GITHUB_REPO
  );

const LOGGER_VERSION =
  'compact-v7-sorted-hands';

/* =========================================================
   COMPACT HISTORY STORAGE
   ========================================================= */

if (
  !existsSync(
    dataDir
  )
) {
  mkdirSync(
    dataDir,
    {
      recursive: true,
    }
  );
}

function emptyHistory() {
  return {
    schemaVersion: 7,
    games: [],
  };
}

function loadLocalHistory() {
  if (
    !existsSync(
      historyFile
    )
  ) {
    return emptyHistory();
  }

  try {
    const parsed =
      JSON.parse(
        readFileSync(
          historyFile,
          'utf8'
        )
      );

    if (
      !parsed ||
      !Array.isArray(
        parsed.games
      )
    ) {
      return emptyHistory();
    }

    return parsed;
  } catch (error) {
    console.error(
      'Could not read local history:',
      error
    );

    return emptyHistory();
  }
}

const historyStatus = {
  lastLocalSave:
    null,

  lastGitHubSyncAttempt:
    null,

  lastGitHubSync:
    null,

  lastGitHubSyncSuccess:
    null,

  lastGitHubError:
    null,
};

let gameHistory =
  loadLocalHistory();

let githubSyncChain =
  Promise.resolve();

let githubSyncTimer =
  null;

function writeLocalHistory() {
  gameHistory =
    compactifyHistory(
      gameHistory
    );

  gameHistory.schemaVersion =
    7;

  writeFileSync(
    historyFile,

    JSON.stringify(
      gameHistory,
      null,
      2
    ),

    'utf8'
  );

  historyStatus
    .lastLocalSave =
    new Date()
      .toISOString();
}

/* =========================================================
   GITHUB API
   ========================================================= */

function githubHeaders() {
  return {
    Accept:
      'application/vnd.github+json',

    Authorization:
      `Bearer ${GITHUB_TOKEN}`,

    'X-GitHub-Api-Version':
      '2022-11-28',

    'User-Agent':
      'daguai-luzi-game',
  };
}

function githubReadUrl() {
  return (
    `https://api.github.com/repos/` +
    `${encodeURIComponent(
      GITHUB_OWNER
    )}/` +
    `${encodeURIComponent(
      GITHUB_REPO
    )}/` +
    `contents/` +
    `${GITHUB_HISTORY_PATH}` +
    `?ref=${encodeURIComponent(
      GITHUB_BRANCH
    )}`
  );
}

function githubWriteUrl() {
  return (
    `https://api.github.com/repos/` +
    `${encodeURIComponent(
      GITHUB_OWNER
    )}/` +
    `${encodeURIComponent(
      GITHUB_REPO
    )}/` +
    `contents/` +
    `${GITHUB_HISTORY_PATH}`
  );
}

async function readRemoteHistory() {
  if (
    !githubSyncEnabled
  ) {
    return null;
  }

  const response =
    await fetch(
      githubReadUrl(),
      {
        headers:
          githubHeaders(),
      }
    );

  if (
    response.status ===
    404
  ) {
    return null;
  }

  if (
    !response.ok
  ) {
    const body =
      await response.text();

    throw new Error(
      `GitHub GET failed: ` +
      `${response.status} ` +
      `${body}`
    );
  }

  const data =
    await response.json();

  const text =
    Buffer
      .from(
        data.content || '',
        'base64'
      )
      .toString(
        'utf8'
      );

  const parsed =
    JSON.parse(
      text
    );

  if (
    !parsed ||
    !Array.isArray(
      parsed.games
    )
  ) {
    return null;
  }

  return {
    history:
      parsed,

    sha:
      data.sha ||
      null,
  };
}

async function pushHistorySnapshot(
  snapshot,
  verifyGameId = null
) {
  if (
    !githubSyncEnabled
  ) {
    return true;
  }

  historyStatus
    .lastGitHubSyncAttempt =
    new Date()
      .toISOString();

  try {
    const remote =
      await readRemoteHistory();

    const body = {
      message:
        `Update compact Daguai history ` +
        new Date()
          .toISOString(),

      branch:
        GITHUB_BRANCH,

      content:
        Buffer
          .from(
            JSON.stringify(
              snapshot,
              null,
              2
            ),

            'utf8'
          )
          .toString(
            'base64'
          ),
    };

    if (
      remote?.sha
    ) {
      body.sha =
        remote.sha;
    }

    const response =
      await fetch(
        githubWriteUrl(),
        {
          method:
            'PUT',

          headers: {
            ...githubHeaders(),

            'Content-Type':
              'application/json',
          },

          body:
            JSON.stringify(
              body
            ),
        }
      );

    if (
      !response.ok
    ) {
      const responseBody =
        await response.text();

      throw new Error(
        `GitHub PUT failed: ` +
        `${response.status} ` +
        `${responseBody}`
      );
    }

    if (
      verifyGameId
    ) {
      const verifiedRemote =
        await readRemoteHistory();

      const exists =
        verifiedRemote
          ?.history
          ?.games
          ?.some(
            (game) =>
              game.gameId ===
              verifyGameId
          );

      if (!exists) {
        throw new Error(
          `GitHub write succeeded but game ` +
          `${verifyGameId} was not found when read back.`
        );
      }
    }

    historyStatus
      .lastGitHubSync =
      new Date()
        .toISOString();

    historyStatus
      .lastGitHubSyncSuccess =
      true;

    historyStatus
      .lastGitHubError =
      null;

    return true;
  } catch (error) {
    historyStatus
      .lastGitHubSyncSuccess =
      false;

    historyStatus
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
  {
    verifyGameId =
      null,
  } = {}
) {
  if (
    !githubSyncEnabled
  ) {
    return Promise.resolve(
      true
    );
  }

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
          pushHistorySnapshot(
            snapshot,
            verifyGameId
          )
      );

  return githubSyncChain;
}

function queueGitHubSync() {
  if (
    !githubSyncEnabled
  ) {
    return;
  }

  clearTimeout(
    githubSyncTimer
  );

  githubSyncTimer =
    setTimeout(
      () => {
        githubSyncTimer =
          null;

        void enqueueGitHubSync();
      },

      600
    );
}

async function saveHistory(
  {
    immediate =
      false,

    verifyGameId =
      null,
  } = {}
) {
  writeLocalHistory();

  if (
    !githubSyncEnabled
  ) {
    return true;
  }

  if (
    immediate
  ) {
    if (
      githubSyncTimer
    ) {
      clearTimeout(
        githubSyncTimer
      );

      githubSyncTimer =
        null;
    }

    return enqueueGitHubSync({
      verifyGameId,
    });
  }

  queueGitHubSync();

  return true;
}

/* =========================================================
   HISTORY INITIALIZATION + AUTOMATIC MIGRATION
   ========================================================= */

async function initializeHistory() {
  if (
    !githubSyncEnabled
  ) {
    writeLocalHistory();

    return;
  }

  try {
    const remote =
      await readRemoteHistory();

    if (
      remote?.history
    ) {
      const needsMigration =
        historyNeedsCompaction(
          remote.history
        );

      gameHistory =
        compactifyHistory(
          remote.history
        );

      writeLocalHistory();

      if (
        needsMigration
      ) {
        console.log(
          'Migrating old game history to compact sorted-hand schema...'
        );

        const migrated =
          await saveHistory({
            immediate:
              true,
          });

        if (
          !migrated
        ) {
          console.error(
            'Compact history migration could not be pushed to GitHub.'
          );
        }
      }

      console.log(
        `Loaded ${gameHistory.games.length} compact game(s) from GitHub.`
      );
    } else {
      gameHistory =
        emptyHistory();

      await saveHistory({
        immediate:
          true,
      });
    }
  } catch (error) {
    historyStatus
      .lastGitHubSyncSuccess =
      false;

    historyStatus
      .lastGitHubError =
      error.message;

    console.error(
      'Could not initialize history from GitHub:',
      error
    );

    writeLocalHistory();
  }
}

/* =========================================================
   COMPACT CARD CODES
   ========================================================= */

function jokerText(
  card
) {
  return [
    card?.rank,
    card?.displayRank,
    card?.jokerType,
    card?.id,
  ]
    .filter(
      Boolean
    )
    .join(
      ' '
    )
    .toLowerCase();
}

function cardCode(
  card
) {
  if (
    card?.isJoker
  ) {
    const text =
      jokerText(
        card
      );

    if (
      text.includes(
        'big'
      ) ||
      text.includes(
        '大怪'
      ) ||
      text.includes(
        'bj'
      )
    ) {
      return 'BJ';
    }

    return 'SJ';
  }

  const suitMap = {
    spades:
      'S',

    hearts:
      'H',

    diamonds:
      'D',

    clubs:
      'C',
  };

  const suit =
    suitMap[
      String(
        card?.suit ||
        ''
      )
        .toLowerCase()
    ] ||
    '?';

  const rank =
    String(
      card?.rank ??
      card?.displayRank ??
      '?'
    )
      .toUpperCase();

  return (
    `${suit}${rank}`
  );
}

/*
  Converts a compact card code
  back into the same basic card
  shape used by sortCards().

  This is used for old compact
  histories whose hands are already
  strings but may not be sorted.
*/
function cardFromCode(
  code,
  index = 0
) {
  const normalized =
    String(
      code ||
      ''
    )
      .trim()
      .toUpperCase();

  if (
    normalized ===
    'BJ'
  ) {
    return {
      id:
        `compact-big-${index}`,

      deckNumber:
        1,

      rank:
        'big-joker',

      displayRank:
        'BJ',

      suit:
        null,

      symbol:
        '★',

      color:
        'red',

      isJoker:
        true,

      jokerType:
        'big',
    };
  }

  if (
    normalized ===
    'SJ'
  ) {
    return {
      id:
        `compact-small-${index}`,

      deckNumber:
        1,

      rank:
        'small-joker',

      displayRank:
        'SJ',

      suit:
        null,

      symbol:
        '★',

      color:
        'black',

      isJoker:
        true,

      jokerType:
        'small',
    };
  }

  const suitCode =
    normalized[0];

  const rank =
    normalized.slice(
      1
    );

  const suitMap = {
    S:
      'spades',

    H:
      'hearts',

    D:
      'diamonds',

    C:
      'clubs',
  };

  const symbolMap = {
    S:
      '♠',

    H:
      '♥',

    D:
      '♦',

    C:
      '♣',
  };

  const colorMap = {
    S:
      'black',

    H:
      'red',

    D:
      'red',

    C:
      'black',
  };

  return {
    id:
      `compact-${index}-${normalized}`,

    deckNumber:
      1,

    rank,

    displayRank:
      null,

    suit:
      suitMap[
        suitCode
      ],

    symbol:
      symbolMap[
        suitCode
      ],

    color:
      colorMap[
        suitCode
      ],

    isJoker:
      false,

    jokerType:
      null,
  };
}

function sortCompactHand(
  value
) {
  const codes =
    Array.isArray(
      value
    )
      ? value
      : String(
          value ||
          ''
        )
          .split(',');

  const cards =
    codes
      .map(
        (code) =>
          String(
            code
          )
            .trim()
      )
      .filter(
        Boolean
      )
      .map(
        (
          code,
          index
        ) =>
          cardFromCode(
            code,
            index
          )
      );

  return sortCards(
    cards
  )
    .map(
      cardCode
    )
    .join(',');
}

function playerKeyFromSeat(
  seatIndex
) {
  return (
    `P${seatIndex + 1}`
  );
}

/* =========================================================
   HISTORY MIGRATION
   ========================================================= */

function playerKeyFromId(
  playerId
) {
  const numeric =
    Number(
      playerId
    );

  if (
    Number.isInteger(
      numeric
    ) &&
    numeric >= 1 &&
    numeric <= 6
  ) {
    return `P${numeric}`;
  }

  return null;
}

function normalizePlayerKey(
  value,
  seatIndex = null
) {
  if (
    typeof value ===
      'string' &&
    /^P[1-6]$/.test(
      value
    )
  ) {
    return value;
  }

  const fromId =
    playerKeyFromId(
      value
    );

  if (
    fromId
  ) {
    return fromId;
  }

  if (
    Number.isInteger(
      seatIndex
    ) &&
    seatIndex >= 0 &&
    seatIndex < 6
  ) {
    return playerKeyFromSeat(
      seatIndex
    );
  }

  return null;
}

function compactStarterReason(
  value
) {
  const reason =
    String(
      value ||
      ''
    );

  if (
    reason ===
      'first_game_spade_tiebreak' ||
    reason ===
      'spade-tiebreak'
  ) {
    return 'spade-tiebreak';
  }

  if (
    reason ===
      'previous_head_player' ||
    reason ===
      'previous-head'
  ) {
    return 'previous-head';
  }

  if (
    reason ===
      'custom_selected' ||
    reason ===
      'custom'
  ) {
    return 'custom';
  }

  return (
    reason ||
    'unknown'
  );
}

function compactPlayers(
  game
) {
  if (
    game.players &&
    !Array.isArray(
      game.players
    )
  ) {
    return game.players;
  }

  const players = {};

  if (
    Array.isArray(
      game.players
    )
  ) {
    game.players.forEach(
      (
        player,
        index
      ) => {
        const key =
          normalizePlayerKey(
            player?.playerId,
            player?.seatIndex ??
              index
          );

        if (
          !key
        ) {
          return;
        }

        players[key] = {
          name:
            player?.name ||
            key,

          team:
            player?.team ||
            null,
        };
      }
    );
  }

  return players;
}

/*
  IMPORTANT:

  Every hand goes through sortCards()
  before becoming the one-line string.

  This applies to:
  - new games
  - old schema 3
  - old compact strings
*/
function compactHands(
  game
) {
  const hands = {
    P1: '',
    P2: '',
    P3: '',
    P4: '',
    P5: '',
    P6: '',
  };

  /*
    Already compact.
  */
  if (
    game.hands &&
    !Array.isArray(
      game.hands
    )
  ) {
    for (
      const playerKey of
      [
        'P1',
        'P2',
        'P3',
        'P4',
        'P5',
        'P6',
      ]
    ) {
      hands[
        playerKey
      ] =
        sortCompactHand(
          game.hands[
            playerKey
          ]
        );
    }

    return hands;
  }

  /*
    Old schema with real card objects.
  */
  if (
    Array.isArray(
      game.initialHands
    )
  ) {
    game.initialHands.forEach(
      (
        entry,
        index
      ) => {
        const key =
          normalizePlayerKey(
            entry?.playerId,
            entry?.seatIndex ??
              index
          );

        if (
          !key
        ) {
          return;
        }

        hands[key] =
          Array.isArray(
            entry?.cards
          )
            ? sortCards(
                [
                  ...entry.cards,
                ]
              )
                .map(
                  cardCode
                )
                .join(',')
            : '';
      }
    );
  }

  return hands;
}

function compactFinishOrder(
  order
) {
  if (
    !Array.isArray(
      order
    )
  ) {
    return [];
  }

  return order
    .map(
      (
        value
      ) => {
        if (
          typeof value ===
            'string' &&
          /^P[1-6]$/.test(
            value
          )
        ) {
          return value;
        }

        return playerKeyFromId(
          value
        );
      }
    )
    .filter(
      Boolean
    );
}

function compactPublicResponse(
  event
) {
  if (
    event.publicResponse ===
      'not-reported' ||
    event.publicResponse ===
      'NR'
  ) {
    return 'NR';
  }

  if (
    Number.isFinite(
      Number(
        event.publicResponse
      )
    )
  ) {
    return Number(
      event.publicResponse
    );
  }

  if (
    Number.isFinite(
      Number(
        event.actualCount
      )
    ) &&
    Number(
      event.actualCount
    ) <= 10
  ) {
    return Number(
      event.actualCount
    );
  }

  return 'NR';
}

function compactRoundsFromEvents(
  game
) {
  if (
    Array.isArray(
      game.rounds
    )
  ) {
    return game.rounds;
  }

  if (
    !Array.isArray(
      game.events
    )
  ) {
    return [];
  }

  const rounds = [];

  let currentRound =
    null;

  let lastPlayPlayer =
    null;

  function ensureRound() {
    if (
      !currentRound
    ) {
      currentRound = {
        r:
          rounds.length +
          1,

        actions:
          [],
      };

      rounds.push(
        currentRound
      );
    }

    return currentRound;
  }

  function finishRound(
    winner = null
  ) {
    if (
      !currentRound
    ) {
      return;
    }

    if (
      winner
    ) {
      currentRound.winner =
        winner;
    }

    currentRound =
      null;

    lastPlayPlayer =
      null;
  }

  for (
    const event of
    game.events
  ) {
    if (
      !event ||
      typeof event !==
        'object'
    ) {
      continue;
    }

    if (
      event.type ===
      'play'
    ) {
      const player =
        normalizePlayerKey(
          event.playerId,
          event.seatIndex
        );

      if (
        !player
      ) {
        continue;
      }

      const cards =
        Array.isArray(
          event.cards
        )
          ? event.cards
              .map(
                (card) =>
                  typeof card ===
                    'string'
                    ? card
                    : cardCode(
                        card
                      )
              )
              .join(',')
          : '';

      ensureRound()
        .actions
        .push(
          [
            player,
            'play',
            cards,
          ]
        );

      lastPlayPlayer =
        player;

      if (
        event.finished
      ) {
        ensureRound()
          .actions
          .push(
            [
              player,
              'out',
            ]
          );
      }

      continue;
    }

    if (
      event.type ===
      'pass'
    ) {
      const player =
        normalizePlayerKey(
          event.playerId,
          event.seatIndex
        );

      if (
        player
      ) {
        ensureRound()
          .actions
          .push(
            [
              player,
              'pass',
            ]
          );
      }

      if (
        event.trickEnded
      ) {
        const leadSeat =
          event
            ?.leadAtPass
            ?.playerIndex;

        const winner =
          Number.isInteger(
            leadSeat
          )
            ? playerKeyFromSeat(
                leadSeat
              )
            : lastPlayPlayer;

        finishRound(
          winner
        );
      }

      continue;
    }

    if (
      event.type ===
      'ask_card_count'
    ) {
      const requester =
        normalizePlayerKey(
          event.requesterPlayerId,
          event.requesterSeatIndex
        );

      const target =
        normalizePlayerKey(
          event.targetPlayerId,
          event.targetSeatIndex
        );

      if (
        requester &&
        target
      ) {
        ensureRound()
          .actions
          .push(
            [
              requester,
              'ask',
              target,
              compactPublicResponse(
                event
              ),
            ]
          );
      }

      continue;
    }
  }

  return rounds;
}

function compactGameRecord(
  game
) {
  /*
    Already compact.

    Still run the hands through
    compactHands() so an old compact
    file with unsorted strings gets fixed.
  */
  if (
    game &&
    game.hands &&
    game.rounds &&
    !game.initialHands
  ) {
    return {
      ...game,

      hands:
        compactHands(
          game
        ),

      starterReason:
        compactStarterReason(
          game.starterReason
        ),

      finishOrder:
        compactFinishOrder(
          game.finishOrder
        ),
    };
  }

  const starter =
    normalizePlayerKey(
      game?.startingPlayerId,
      game?.startingPlayerSeatIndex
    ) ||
    normalizePlayerKey(
      game?.starter
    ) ||
    'P1';

  const compact = {
    gameId:
      game?.gameId ||
      randomUUID(),

    time:
      game?.time ||
      game?.dealtAt ||
      new Date()
        .toISOString(),

    deal:
      game?.deal ||
      game?.dealSource ||
      'unknown',

    trump:
      game?.trump ||
      game?.trumpRank ||
      null,

    starter,

    starterReason:
      compactStarterReason(
        game?.starterReason ||
        game?.startingPlayerMethod
      ),

    players:
      compactPlayers(
        game ||
        {}
      ),

    hands:
      compactHands(
        game ||
        {}
      ),

    rounds:
      compactRoundsFromEvents(
        game ||
        {}
      ),

    finishOrder:
      compactFinishOrder(
        game?.finishOrder
      ),
  };

  const startingFinishOrder =
    compactFinishOrder(
      game?.startingFinishOrder
    );

  if (
    startingFinishOrder.length >
      0
  ) {
    compact
      .startingFinishOrder =
      startingFinishOrder;
  }

  const ended =
    game?.ended ||
    game?.endedAt;

  if (
    ended
  ) {
    compact.ended =
      ended;
  }

  const endReason =
    game?.endReason ||
    game?.endedReason;

  if (
    endReason
  ) {
    compact.endReason =
      endReason;
  }

  return compact;
}

function compactifyHistory(
  history
) {
  const games =
    Array.isArray(
      history?.games
    )
      ? history.games.map(
          compactGameRecord
        )
      : [];

  return {
    schemaVersion:
      7,

    games,
  };
}

function historyNeedsCompaction(
  history
) {
  /*
    Bumping to schema 7 is deliberate.

    Even schema 6 compact files need
    one more migration because their
    hand strings may not be sorted.
  */
  if (
    Number(
      history?.schemaVersion
    ) !== 7
  ) {
    return true;
  }

  if (
    !Array.isArray(
      history?.games
    )
  ) {
    return true;
  }

  return history.games.some(
    (game) =>
      Boolean(
        game?.initialHands ||
        game?.events ||
        game?.startingPlayerComparison ||
        game?.dealtAtMinute
      )
  );
}

/* =========================================================
   COMPACT ROUND LOGGING
   ========================================================= */

function getCompactGame(
  room
) {
  if (
    !room.state.gameId
  ) {
    return null;
  }

  return (
    gameHistory.games.find(
      (game) =>
        game.gameId ===
        room.state.gameId
    ) ||
    null
  );
}

function ensureOpenRound(
  game
) {
  let round =
    game.rounds[
      game.rounds.length -
      1
    ];

  if (
    !round ||
    round.winner
  ) {
    round = {
      r:
        game.rounds.length +
        1,

      actions:
        [],
    };

    game.rounds.push(
      round
    );
  }

  return round;
}

function addRoundAction(
  room,
  action
) {
  const game =
    getCompactGame(
      room
    );

  if (!game) {
    return;
  }

  const round =
    ensureOpenRound(
      game
    );

  round.actions.push(
    action
  );

  game.finishOrder =
    room.state
      .finishOrder
      .map(
        (id) =>
          `P${id}`
      );

  void saveHistory();
}

function closeCurrentRound(
  room,
  winnerSeatIndex
) {
  const game =
    getCompactGame(
      room
    );

  if (
    !game ||
    game.rounds.length ===
      0
  ) {
    return;
  }

  const round =
    game.rounds[
      game.rounds.length -
      1
    ];

  if (
    !round ||
    round.winner
  ) {
    return;
  }

  round.winner =
    playerKeyFromSeat(
      winnerSeatIndex
    );

  game.finishOrder =
    room.state
      .finishOrder
      .map(
        (id) =>
          `P${id}`
      );

  void saveHistory();
}

function updateCompactGameFinishOrder(
  room
) {
  const game =
    getCompactGame(
      room
    );

  if (!game) {
    return;
  }

  game.finishOrder =
    room.state
      .finishOrder
      .map(
        (id) =>
          `P${id}`
      );

  void saveHistory();
}

/* =========================================================
   NEW COMPACT GAME RECORD
   ========================================================= */

function buildCompactGameRecord({
  room,
  dealSource,
  startingPlayerIndex,
  startingReason,
  hands,
  trumpRank,
  startingFinishOrder = [],
}) {
  const gameId =
    `${room.code}-` +
    randomUUID();

  const time =
    new Date()
      .toISOString();

  const players =
    {};

  const compactHands =
    {};

  room.players.forEach(
    (
      player,
      seatIndex
    ) => {
      const key =
        playerKeyFromSeat(
          seatIndex
        );

      players[key] = {
        name:
          player.name,

        team:
          player.team,
      };

      /*
        IMPORTANT:

        Sort first.
        Then convert to S3/H4/etc.
        Then join onto ONE line.
      */
      compactHands[key] =
        sortCards(
          [
            ...hands[
              seatIndex
            ],
          ]
        )
          .map(
            cardCode
          )
          .join(',');
    }
  );

  const record = {
    gameId,

    time,

    deal:
      dealSource,

    trump:
      trumpRank,

    starter:
      playerKeyFromSeat(
        startingPlayerIndex
      ),

    starterReason:
      startingReason,

    players,

    hands:
      compactHands,

    rounds:
      [],

    finishOrder:
      startingFinishOrder
        .map(
          (id) =>
            `P${id}`
        ),
  };

  if (
    startingFinishOrder
      .length > 0
  ) {
    record
      .startingFinishOrder =
      startingFinishOrder
        .map(
          (id) =>
            `P${id}`
        );
  }

  return record;
}

async function registerNewCompactGame({
  room,
  dealSource,
  startingPlayerIndex,
  startingReason,
  hands,
  trumpRank,
  startingFinishOrder = [],
}) {
  const record =
    buildCompactGameRecord({
      room,

      dealSource,

      startingPlayerIndex,

      startingReason,

      hands,

      trumpRank,

      startingFinishOrder,
    });

  gameHistory.games.push(
    record
  );

  writeLocalHistory();

  const ok =
    await saveHistory({
      immediate:
        true,

      verifyGameId:
        record.gameId,
    });

  if (!ok) {
    gameHistory.games =
      gameHistory.games
        .filter(
          (game) =>
            game.gameId !==
            record.gameId
        );

    writeLocalHistory();

    return null;
  }

  return record;
}

function markGameEnded(
  room,
  reason
) {
  const game =
    getCompactGame(
      room
    );

  if (!game) {
    return;
  }

  game.finishOrder =
    room.state
      .finishOrder
      .map(
        (id) =>
          `P${id}`
      );

  game.ended =
    new Date()
      .toISOString();

  game.endReason =
    reason;

  void saveHistory();
}

/* =========================================================
   EXPRESS / SOCKET.IO
   ========================================================= */

const app =
  express();

const httpServer =
  createServer(
    app
  );

const io =
  new Server(
    httpServer,
    {
      cors: {
        origin:
          '*',
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
  (
    _req,
    res
  ) => {
    res.sendFile(
      path.join(
        publicDir,
        'index.html'
      )
    );
  }
);

/* =========================================================
   HISTORY STATUS
   ========================================================= */

app.get(
  '/api/history-status',
  (
    _req,
    res
  ) => {
    res.json({
      logging:
        true,

      loggerVersion:
        LOGGER_VERSION,

      schemaVersion:
        gameHistory
          .schemaVersion,

      githubSync:
        githubSyncEnabled,

      gameCount:
        gameHistory
          .games
          .length,

      lastLocalSave:
        historyStatus
          .lastLocalSave,

      lastGitHubSyncAttempt:
        historyStatus
          .lastGitHubSyncAttempt,

      lastGitHubSync:
        historyStatus
          .lastGitHubSync,

      lastGitHubSyncSuccess:
        historyStatus
          .lastGitHubSyncSuccess,

      lastGitHubError:
        historyStatus
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
   ROOM HELPERS
   ========================================================= */

const rooms =
  new Map();

function generateRoomCode() {
  let code;

  do {
    code =
      Math
        .random()
        .toString(
          36
        )
        .slice(
          2,
          8
        )
        .toUpperCase();
  } while (
    rooms.has(
      code
    )
  );

  return code;
}

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
      new Date()
        .toISOString(),

    askedByPlayerId,
  };
}

function createRoom(
  roomCode,
  hostName,
  hostSocketId
) {
  return {
    code:
      roomCode,

    advanceTimer:
      null,

    previousHeadPlayerIndex:
      null,

    players: [
      {
        id: 1,

        name:
          hostName ||
          'Player 1',

        team:
          'A',

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
    },
  };
}

function touchRoom(
  room
) {
  room.state.revision +=
    1;
}

function connectedCount(
  room
) {
  return (
    room.players
      .filter(
        (player) =>
          Boolean(
            player.socketId
          )
      )
      .length
  );
}

function activeCount(
  room
) {
  return (
    room.players
      .filter(
        (player) =>
          Boolean(
            player.socketId
          ) &&
          !player.hasFinished
      )
      .length
  );
}

function nextActivePlayer(
  room,
  fromIndex
) {
  for (
    let offset = 1;
    offset <= 6;
    offset += 1
  ) {
    const index =
      (
        fromIndex +
        offset
      ) % 6;

    const player =
      room.players[
        index
      ];

    if (
      player.socketId &&
      !player.hasFinished
    ) {
      return index;
    }
  }

  return null;
}

function passesNeeded(
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

  return Math.max(
    1,

    activeCount(
      room
    ) -
      (
        leaderStillActive
          ? 1
          : 0
      )
  );
}

/* =========================================================
   STARTING PLAYER RULE
   ========================================================= */

const openingSpadeRanks = [
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

function isSpade(
  card
) {
  return (
    String(
      card?.suit ||
      ''
    )
      .toLowerCase() ===
      'spades' ||

    String(
      card?.symbol ||
      ''
    ) ===
      '♠'
  );
}

function countSpadeRank(
  hand,
  rank
) {
  return (
    hand.filter(
      (card) =>
        isSpade(
          card
        ) &&

        String(
          card.rank
        )
          .toUpperCase() ===
          rank
    )
      .length
  );
}

function determineFirstGameStarter(
  hands
) {
  let candidates = [
    0,
    1,
    2,
    3,
    4,
    5,
  ];

  for (
    const rank of
    openingSpadeRanks
  ) {
    const counts =
      hands.map(
        (hand) =>
          countSpadeRank(
            hand,
            rank
          )
      );

    const max =
      Math.max(
        ...candidates
          .map(
            (seat) =>
              counts[
                seat
              ]
          )
      );

    candidates =
      candidates
        .filter(
          (seat) =>
            counts[
              seat
            ] ===
            max
        );

    if (
      candidates.length ===
      1
    ) {
      break;
    }
  }

  return candidates[0];
}

function determineRandomStarter(
  room,
  hands
) {
  if (
    Number.isInteger(
      room
        .previousHeadPlayerIndex
    )
  ) {
    return {
      seatIndex:
        room
          .previousHeadPlayerIndex,

      reason:
        'previous-head',
    };
  }

  return {
    seatIndex:
      determineFirstGameStarter(
        hands
      ),

    reason:
      'spade-tiebreak',
  };
}

/* =========================================================
   CUSTOM DEAL PARSING
   ========================================================= */

function normalizeCardToken(
  rawToken
) {
  let token =
    String(
      rawToken ||
      ''
    )
      .trim()
      .toUpperCase()
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
    [
      'BIGJOKER',
      'BIG',
      '大怪',
    ].includes(
      token
    )
  ) {
    return 'BJ';
  }

  if (
    [
      'SMALLJOKER',
      'SMALL',
      '小怪',
    ].includes(
      token
    )
  ) {
    return 'SJ';
  }

  return token;
}

function tokenizeHandText(
  text
) {
  return (
    String(
      text ||
      ''
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
      )
      .split(
        /\s+/
      )
      .map(
        normalizeCardToken
      )
      .filter(
        Boolean
      )
  );
}

function parseCardToken(
  token
) {
  if (
    token ===
    'BJ'
  ) {
    return {
      kind:
        'big-joker',
    };
  }

  if (
    token ===
    'SJ'
  ) {
    return {
      kind:
        'small-joker',
    };
  }

  let match =
    token.match(
      /^(10|[2-9JQKA])([SHCD])$/
    );

  if (
    match
  ) {
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

  if (
    match
  ) {
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
    `Use S3, H10, DQ, CA, BJ, or SJ.`
  );
}

function suitCodeToName(
  code
) {
  return {
    S:
      'spades',

    H:
      'hearts',

    D:
      'diamonds',

    C:
      'clubs',
  }[code];
}

function cardMatchesRequest(
  card,
  request
) {
  if (
    request.kind ===
    'big-joker'
  ) {
    return (
      cardCode(
        card
      ) ===
      'BJ'
    );
  }

  if (
    request.kind ===
    'small-joker'
  ) {
    return (
      cardCode(
        card
      ) ===
      'SJ'
    );
  }

  return (
    String(
      card.rank
    )
      .toUpperCase() ===
      request.rank &&

    String(
      card.suit
    )
      .toLowerCase() ===
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
    handTexts.length !==
      6
  ) {
    throw new Error(
      'Custom deal must contain exactly six hands.'
    );
  }

  const pool =
    createNewDeal()
      .hands
      .flat();

  const usedIds =
    new Set();

  const hands =
    Array.from(
      {
        length:
          6,
      },

      () =>
        []
    );

  for (
    let seatIndex = 0;
    seatIndex < 6;
    seatIndex += 1
  ) {
    for (
      const token of
      tokenizeHandText(
        handTexts[
          seatIndex
        ]
      )
    ) {
      const request =
        parseCardToken(
          token
        );

      const card =
        pool.find(
          (candidate) =>
            !usedIds.has(
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
          `${token} is unavailable or used too many times.`
        );
      }

      usedIds.add(
        card.id
      );

      hands[
        seatIndex
      ].push(
        card
      );
    }
  }

  return {
    hands:
      hands.map(
        (hand) =>
          sortCards(
            hand
          )
      ),
  };
}

function parseFinishOrder(
  raw
) {
  const text =
    String(
      raw ||
      ''
    )
      .trim();

  if (!text) {
    return [];
  }

  const values =
    text
      .split(
        /[\s,;]+/
      )
      .filter(
        Boolean
      )
      .map(
        Number
      );

  if (
    values.some(
      (value) =>
        !Number.isInteger(
          value
        ) ||
        value < 1 ||
        value > 6
    )
  ) {
    throw new Error(
      'Finished order may only contain player numbers 1-6.'
    );
  }

  if (
    new Set(
      values
    ).size !==
    values.length
  ) {
    throw new Error(
      'A player cannot appear twice in Finished order.'
    );
  }

  return values;
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
      hands:
        room.state
          .hands
          .map(
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
   START GAME
   ========================================================= */

async function startGame({
  room,
  hands,
  trumpRank,
  startingPlayerIndex,
  startingReason,
  finishOrder = [],
  dealSource,
}) {
  const record =
    await registerNewCompactGame({
      room,

      dealSource,

      startingPlayerIndex,

      startingReason,

      hands,

      trumpRank,

      startingFinishOrder:
        finishOrder,
    });

  if (!record) {
    return {
      success:
        false,

      message:
        'Deal cancelled because the history could not be written to GitHub. ' +
        'Check /api/history-status.',
    };
  }

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

  room.state.gameId =
    record.gameId;

  room.state.dealtAt =
    record.time;

  room.state.dealSource =
    dealSource;

  room.state.publicReports =
    createEmptyPublicReports();

  room.players.forEach(
    (player) => {
      player.hasFinished =
        finishOrder.includes(
          player.id
        );
    }
  );

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
      record.gameId,

    dealtAt:
      record.time,
  };
}

function stopAdvanceTimer(
  room
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
}

function abortCurrentGame(
  room,
  reason
) {
  if (
    !room.state.gameId
  ) {
    return;
  }

  markGameEnded(
    room,
    reason
  );

  stopAdvanceTimer(
    room
  );
}

function destroyRoom(
  room,
  reason
) {
  abortCurrentGame(
    room,
    reason
  );

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
  stopAdvanceTimer(
    room
  );

  const gameId =
    room.state
      .gameId;

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
          activeCount(
            currentRoom
          ) <= 1
        ) {
          closeCurrentRound(
            currentRoom,
            playerSeatIndex
          );

          currentRoom.state
            .hasStarted =
            false;

          currentRoom.state
            .phase =
            'finished';

          markGameEnded(
            currentRoom,
            'one-player-remaining'
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

        const nextIndex =
          nextActivePlayer(
            currentRoom,
            playerSeatIndex
          );

        if (
          nextIndex ===
          null
        ) {
          currentRoom.state
            .hasStarted =
            false;

          currentRoom.state
            .phase =
            'finished';

          markGameEnded(
            currentRoom,
            'no-active-next-player'
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
          nextIndex;

        currentRoom.state
          .phase =
          'turn';

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
  (
    socket
  ) => {
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
          createRoom(
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
            roomCode ||
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

        seat.name =
          cleanName ||
          `Player ${parsedSeatIndex + 1}`;

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
          connectedCount(
            room
          ) === 6
        ) {
          room.state.paused =
            false;
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
          connectedCount(
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
            .hasStarted
        ) {
          abortCurrentGame(
            room,
            'host-redeal'
          );
        }

        const deal =
          createNewDeal();

        const starter =
          determineRandomStarter(
            room,
            deal.hands
          );

        const result =
          await startGame({
            room,

            hands:
              deal.hands,

            trumpRank:
              room.state
                .trumpRank ||
              '2',

            startingPlayerIndex:
              starter
                .seatIndex,

            startingReason:
              starter
                .reason,

            finishOrder:
              [],

            dealSource:
              'random',
          });

        callback(
          result
        );
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
          connectedCount(
            room
          ) !== 6
        ) {
          callback({
            success:
              false,

            message:
              'All 6 players must be connected before custom deal.',
          });

          return;
        }

        try {
          const finishOrder =
            parseFinishOrder(
              finishOrderText
            );

          const startIndex =
            Number(
              startingPlayerIndex
            );

          const selectedTrump =
            String(
              trumpRank ||
              '2'
            )
              .toUpperCase();

          const custom =
            buildCustomHands(
              handTexts
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

          if (
            finishOrder.includes(
              startIndex + 1
            )
          ) {
            throw new Error(
              'Starting player cannot already be finished.'
            );
          }

          for (
            const playerId of
            finishOrder
          ) {
            if (
              custom.hands[
                playerId - 1
              ].length !==
              0
            ) {
              throw new Error(
                `Player ${playerId} is listed as finished but still has cards.`
              );
            }
          }

          if (
            room.state
              .hasStarted
          ) {
            abortCurrentGame(
              room,
              'host-custom-redeal'
            );
          }

          const result =
            await startGame({
              room,

              hands:
                custom.hands,

              trumpRank:
                selectedTrump,

              startingPlayerIndex:
                startIndex,

              startingReason:
                'custom',

              finishOrder,

              dealSource:
                'custom',
            });

          callback(
            result
          );
        } catch (
          error
        ) {
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
          !room.state
            .gameId
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
          targetIndex > 5 ||
          targetIndex ===
            playerSeatIndex
        ) {
          callback({
            success:
              false,

            message:
              'Invalid player.',
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

        const response =
          actualCount <= 10
            ? actualCount
            : 'NR';

        if (
          actualCount <= 10
        ) {
          room.state
            .publicReports[
              targetIndex
            ] =
            makeReportedCount(
              actualCount,
              requester.id
            );
        } else {
          room.state
            .publicReports[
              targetIndex
            ] = {
              status:
                'not-reported',

              count:
                null,

              askedAt:
                new Date()
                  .toISOString(),

              askedByPlayerId:
                requester.id,
            };
        }

        addRoundAction(
          room,
          [
            playerKeyFromSeat(
              playerSeatIndex
            ),

            'ask',

            playerKeyFromSeat(
              targetIndex
            ),

            response,
          ]
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

            actualCount <= 10
              ? `${requester.name} asked ${target.name}: ${actualCount} cards`
              : `${requester.name} asked ${target.name}: Not reported`
          );

        callback({
          success:
            true,
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
              'Game is paused.',
          });

          return;
        }

        if (
          room.state.phase !==
            'turn' ||
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

        const uniqueIds =
          [
            ...new Set(
              cardIds
            ),
          ];

        const hand =
          room.state.hands[
            playerSeatIndex
          ];

        const selectedCards =
          hand.filter(
            (card) =>
              uniqueIds.includes(
                card.id
              )
          );

        if (
          selectedCards.length !==
          uniqueIds.length
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

        room.state.hands[
          playerSeatIndex
        ] =
          hand.filter(
            (card) =>
              !uniqueIds
                .includes(
                  card.id
                )
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

        /*
          Played cards stay on ONE line.

          Example:
          ["P4","play","S7,H7,C7"]
        */
        addRoundAction(
          room,
          [
            playerKeyFromSeat(
              playerSeatIndex
            ),

            'play',

            selectedCards
              .map(
                cardCode
              )
              .join(','),
          ]
        );

        const remaining =
          room.state.hands[
            playerSeatIndex
          ].length;

        if (
          remaining === 0
        ) {
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
            if (
              room.state
                .finishOrder
                .length === 0
            ) {
              room.previousHeadPlayerIndex =
                playerSeatIndex;
            }

            room.state
              .finishOrder
              .push(
                playerId
              );

            addRoundAction(
              room,
              [
                playerKeyFromSeat(
                  playerSeatIndex
                ),

                'out',
              ]
            );

            updateCompactGameFinishOrder(
              room
            );
          }
        }

        const existingReport =
          room.state
            .publicReports[
              playerSeatIndex
            ];

        if (
          existingReport
            ?.status ===
          'reported'
        ) {
          room.state
            .publicReports[
              playerSeatIndex
            ] = {
              ...existingReport,

              count:
                remaining,

              updatedAt:
                new Date()
                  .toISOString(),
            };
        }

        if (
          remaining === 0
        ) {
          room.state
            .publicReports[
              playerSeatIndex
            ] =
            makeReportedCount(
              0
            );
        }

        room.state.phase =
          'showing-play';

        room.state
          .turnLockedUntil =
          Date.now() +
          2000;

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
              'Game is paused.',
          });

          return;
        }

        if (
          room.state.phase !==
            'turn' ||
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

        addRoundAction(
          room,
          [
            playerKeyFromSeat(
              playerSeatIndex
            ),

            'pass',
          ]
        );

        room.state
          .consecutivePasses +=
          1;

        const needed =
          passesNeeded(
            room
          );

        let nextIndex =
          null;

        if (
          room.state
            .consecutivePasses >=
          needed
        ) {
          const winnerSeatIndex =
            room.state
              .lastSuccessfulPlayerIndex;

          closeCurrentRound(
            room,
            winnerSeatIndex
          );

          room.state.currentLead =
            null;

          room.state
            .consecutivePasses =
            0;

          if (
            winnerSeatIndex !==
              null &&
            room.players[
              winnerSeatIndex
            ].socketId &&
            !room.players[
              winnerSeatIndex
            ].hasFinished
          ) {
            nextIndex =
              winnerSeatIndex;
          } else {
            nextIndex =
              nextActivePlayer(
                room,

                winnerSeatIndex ??
                  playerSeatIndex
              );
          }
        } else {
          nextIndex =
            nextActivePlayer(
              room,
              playerSeatIndex
            );
        }

        if (
          nextIndex ===
          null
        ) {
          room.state
            .hasStarted =
            false;

          room.state
            .phase =
            'finished';

          markGameEnded(
            room,
            'no-active-next-player'
          );
        } else {
          room.state
            .currentPlayerIndex =
            nextIndex;

          room.state.phase =
            'turn';
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

        if (
          playerSeatIndex ===
          0
        ) {
          destroyRoom(
            room,
            'host-disconnected'
          );

          return;
        }

        room.players[
          playerSeatIndex
        ].socketId =
          null;

        if (
          room.state
            .hasStarted
        ) {
          room.state.paused =
            true;

          io
            .to(
              room.code
            )
            .emit(
              'toast',

              `${room.players[playerSeatIndex].name} disconnected. Game paused.`
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
  ) ||
  3000;

httpServer.listen(
  PORT,
  '0.0.0.0',

  () => {
    console.log(
      `Daguai Luzi server running on port ${PORT}`
    );

    console.log(
      `Logger version: ${LOGGER_VERSION}`
    );

    console.log(
      `Compact history: ${historyFile}`
    );

    console.log(
      githubSyncEnabled
        ? `GitHub history sync enabled: ${GITHUB_OWNER}/${GITHUB_REPO}/${GITHUB_HISTORY_PATH}`
        : 'GitHub history sync disabled.'
    );
  }
);