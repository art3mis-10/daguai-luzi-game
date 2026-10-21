import { sortCards } from '/game/deck.js';

/*
  Same-origin connection.

  This works both in development
  and after deployment to a real
  internet-accessible Node server.
*/
const socket = window.io();

let localSeatIndex = null;

let roomState = null;

let selectedCardIds = [];

let lastRevision = -1;

/* =========================================================
   APP HTML
   ========================================================= */

document.querySelector('#app').innerHTML = `
  <div
    id="room-modal"
    class="modal-backdrop"
  >
    <div class="modal lobby-modal">
      <div class="modal-header">
        <h2>
          Daguai Luzi Online Lobby
        </h2>
      </div>

      <p>
        Create a room as Player 1,
        or join an existing room in
        a specific seat.
      </p>

      <label
        class="field-label"
        for="player-name-input"
      >
        Player name
      </label>

      <input
        class="text-input"
        type="text"
        id="player-name-input"
        placeholder="Your name"
        maxlength="24"
      />

      <button
        class="primary-button full-width"
        id="create-room-btn"
      >
        Create Room
      </button>

      <div class="lobby-divider">
        <span>
          or join
        </span>
      </div>

      <div class="join-grid">
        <div>
          <label
            class="field-label"
            for="room-code-input"
          >
            Room code
          </label>

          <input
            class="text-input uppercase"
            type="text"
            id="room-code-input"
            placeholder="ABC123"
            maxlength="6"
          />
        </div>

        <div>
          <label
            class="field-label"
            for="seat-select"
          >
            Seat
          </label>

          <select
            class="text-input"
            id="seat-select"
          >
            <option value="1">
              Player 2 · Team B
            </option>

            <option value="2">
              Player 3 · Team A
            </option>

            <option value="3">
              Player 4 · Team B
            </option>

            <option value="4">
              Player 5 · Team A
            </option>

            <option value="5">
              Player 6 · Team B
            </option>
          </select>
        </div>
      </div>

      <button
        class="secondary-button full-width"
        id="join-room-btn"
      >
        Join Room
      </button>

      <div
        id="connection-status"
        class="connection-status"
      >
        Connecting…
      </div>
    </div>
  </div>

  <div class="game-shell">
    <header class="top-bar">
      <div class="brand">
        <div class="brand-mark">
          怪
        </div>

        <div>
          <h1>
            Daguai Luzi
          </h1>

          <p>
            Online Card Room
          </p>
        </div>
      </div>

      <div class="game-info">
        <div class="info-item">
          <span>
            Room
          </span>

          <strong
            id="room-code-display"
          >
            ------
          </strong>
        </div>

        <div class="info-item">
          <span>
            Trump
          </span>

          <strong
            class="trump-rank"
            id="trump-rank-display"
          >
            2
          </strong>
        </div>

        <div class="info-item">
          <span>
            Dealt
          </span>

          <strong
            id="deal-time-display"
          >
            Not dealt
          </strong>
        </div>

        <div class="info-item">
          <span>
            Game
          </span>

          <strong>
            Game 1
          </strong>
        </div>
      </div>

      <div class="top-actions">
        <button
          class="deal-button"
          id="deal-button"
        >
          Deal
        </button>

        <button
          class="icon-button"
          id="menu-button"
          aria-label="Menu"
        >
          ☰
        </button>
      </div>
    </header>

    <main class="game-area">
      <section class="table-panel">
        <div class="table-surface">
          <div
            id="player-seats"
          >
          </div>

          <div class="center-zone">
            <div
              class="turn-indicator"
              id="turn-indicator"
            >
              Waiting to deal
            </div>

            <div class="current-play-label">
              Current Play
            </div>

            <div
              class="current-play"
              id="current-play"
            >
              <div class="empty-play">
                <span>
                  No active play
                </span>
              </div>
            </div>

            <div
              class="last-player"
              id="last-player"
            >
              No previous play
            </div>
          </div>

          <div
            class="direction-ring"
            aria-hidden="true"
          >
            <span>
              ↺
            </span>
          </div>
        </div>
      </section>

      <section class="bottom-panel">
        <div class="self-row">
          <div class="self-profile">
            <div
              class="player-avatar team-a current"
              id="active-player-avatar"
            >
              1
            </div>

            <div class="self-details">
              <strong
                id="active-player-name"
              >
                Player 1
              </strong>

              <span
                id="active-player-team"
              >
                Team A
              </span>
            </div>
          </div>

          <div class="hand-meta">
            <span>
              Current hand
            </span>

            <strong
              id="own-card-count"
            >
              0 cards
            </strong>
          </div>

          <div class="communication-controls">
            <button
              class="secondary-button"
              id="ask-button"
            >
              Ask
            </button>

            <button
              class="secondary-button"
              id="report-button"
            >
              Report
            </button>
          </div>
        </div>

        <div class="hand-scroll">
          <div
            class="player-hand"
            id="player-hand"
          >
            <div class="empty-hand">
              Create or join a room to begin.
            </div>
          </div>
        </div>

        <div class="action-bar">
          <div class="selection-info">
            Selected

            <strong
              id="selected-count"
            >
              0
            </strong>

            cards
          </div>

          <div class="main-actions">
            <button
              class="action-button pass-button"
              id="pass-button"
              disabled
            >
              Pass
            </button>

            <button
              class="action-button play-button"
              id="play-button"
              disabled
            >
              Play
            </button>
          </div>

          <button
            class="sort-button"
            id="sort-button"
            disabled
          >
            Sort
          </button>
        </div>
      </section>
    </main>

    <div
      class="toast"
      id="toast"
    >
    </div>

    <div
      class="modal-backdrop hidden"
      id="report-modal"
    >
      <div class="modal">
        <div class="modal-header">
          <h2>
            Report Hand
          </h2>

          <button
            class="close-button"
            id="close-report-modal"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p>
          The reporting system is not
          networked yet.
        </p>

        <div class="modal-actions">
          <button
            class="secondary-button"
            id="report-count-button"
          >
            Report Card Count
          </button>

          <button
            class="primary-button"
            id="report-route-button"
          >
            Report Luzi
          </button>
        </div>
      </div>
    </div>
  </div>
`;

/* =========================================================
   DOM
   ========================================================= */

const roomModal = document.querySelector('#room-modal');

const createRoomBtn = document.querySelector('#create-room-btn');

const joinRoomBtn = document.querySelector('#join-room-btn');

const playerNameInput = document.querySelector('#player-name-input');

const roomCodeInput = document.querySelector('#room-code-input');

const seatSelect = document.querySelector('#seat-select');

const connectionStatus = document.querySelector('#connection-status');

const roomCodeDisplay = document.querySelector('#room-code-display');

const trumpRankDisplay = document.querySelector('#trump-rank-display');

const dealTimeDisplay = document.querySelector('#deal-time-display');

const playerSeatsElement = document.querySelector('#player-seats');

const playerHandElement = document.querySelector('#player-hand');

const selectedCountElement = document.querySelector('#selected-count');

const dealButton = document.querySelector('#deal-button');

const ownCardCountElement = document.querySelector('#own-card-count');

const playButton = document.querySelector('#play-button');

const passButton = document.querySelector('#pass-button');

const sortButton = document.querySelector('#sort-button');

const currentPlayElement = document.querySelector('#current-play');

const lastPlayerElement = document.querySelector('#last-player');

const turnIndicatorElement = document.querySelector('#turn-indicator');

const toastElement = document.querySelector('#toast');

const activePlayerNameElement = document.querySelector('#active-player-name');

const activePlayerTeamElement = document.querySelector('#active-player-team');

const activePlayerAvatarElement = document.querySelector(
  '#active-player-avatar'
);

const reportButton = document.querySelector('#report-button');

const reportModal = document.querySelector('#report-modal');

const closeReportModalButton = document.querySelector('#close-report-modal');

/* =========================================================
   HELPERS
   ========================================================= */

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showToast(message) {
  toastElement.textContent = message;

  toastElement.classList.add('visible');

  window.clearTimeout(showToast.timeoutId);

  showToast.timeoutId = window.setTimeout(() => {
    toastElement.classList.remove('visible');
  }, 2400);
}

function formatDealTime(timestamp) {
  if (!timestamp) {
    return 'Not dealt';
  }

  const date = new Date(timestamp);

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function getPositionForOffset(offset) {
  const positions = {
    1: 'bottom-left',
    2: 'top-left',
    3: 'top',
    4: 'top-right',
    5: 'bottom-right',
  };

  return positions[offset];
}

function getLocalHand() {
  if (!roomState || localSeatIndex === null) {
    return [];
  }

  return roomState.state.hands[localSeatIndex] || [];
}

/* =========================================================
   REVISION-SAFE STATE UPDATE
   ========================================================= */

function applyRoomState(data) {
  const incomingRevision = data?.state?.revision ?? -1;

  /*
    Socket.IO normally preserves
    ordering, but revision checking
    protects us from stale state
    replacing newer state.
  */
  if (
    roomState &&
    data.code === roomState.code &&
    incomingRevision < lastRevision
  ) {
    return;
  }

  lastRevision = incomingRevision;

  roomState = data;

  renderGame();
}

/* =========================================================
   OTHER PLAYERS
   ========================================================= */

function renderPlayerSeats() {
  if (!roomState || localSeatIndex === null) {
    playerSeatsElement.innerHTML = '';

    return;
  }

  const markup = [];

  for (let offset = 1; offset <= 5; offset += 1) {
    const playerIndex = (localSeatIndex + offset) % 6;

    const player = roomState.players[playerIndex];

    let status = 'Ready';

    if (!player.connected) {
      status = 'Disconnected';
    }

    if (player.hasFinished) {
      status = 'Finished';
    }

    const position = getPositionForOffset(offset);

    markup.push(`
      <div
        class="player-seat ${position}"
        data-player-index="${playerIndex}"
      >
        <div
          class="player-avatar team-${player.team.toLowerCase()}"
        >
          ${player.id}
        </div>

        <div class="player-details">
          <strong>
            ${escapeHtml(player.name)}
          </strong>

          <span
            class="player-status"
          >
            ${status}
          </span>
        </div>

        ${
          player.connected && !player.hasFinished
            ? `
              <div
                class="hidden-hand"
                aria-label="Hidden hand"
              >
                <span></span>
                <span></span>
                <span></span>
              </div>
            `
            : ''
        }
      </div>
    `);
  }

  playerSeatsElement.innerHTML = markup.join('');
}

/* =========================================================
   LOCAL HAND
   ========================================================= */

function renderHand() {
  if (!roomState || localSeatIndex === null) {
    return;
  }

  const player = roomState.players[localSeatIndex];

  const hand = getLocalHand();

  activePlayerNameElement.textContent = player.name;

  activePlayerTeamElement.textContent = `Team ${player.team}`;

  activePlayerAvatarElement.textContent = player.id;

  activePlayerAvatarElement.className = `player-avatar team-${player.team.toLowerCase()} current`;

  trumpRankDisplay.textContent = roomState.state.trumpRank;

  dealTimeDisplay.textContent = formatDealTime(roomState.state.dealtAt);

  /*
    Remove selected IDs that
    disappeared after a play.
  */
  const availableIds = new Set(hand.map((card) => card.id));

  selectedCardIds = selectedCardIds.filter((id) => availableIds.has(id));

  if (!roomState.state.hasStarted) {
    playerHandElement.innerHTML = `
      <div class="empty-hand">
        Waiting for Player 1 to deal.
      </div>
    `;

    ownCardCountElement.textContent = '0 cards';

    return;
  }

  ownCardCountElement.textContent = `${hand.length} cards`;

  if (hand.length === 0) {
    playerHandElement.innerHTML = `
      <div class="empty-hand">
        You have finished.
      </div>
    `;

    return;
  }

  playerHandElement.innerHTML = hand
    .map((card) => {
      const selected = selectedCardIds.includes(card.id);

      const displayedRank = card.displayRank ?? card.rank;

      return `
            <button
              class="
                playing-card
                ${card.color}
                ${selected ? 'selected' : ''}
                ${card.isJoker ? 'joker-card' : ''}
              "
              data-card-id="${card.id}"
              aria-pressed="${selected}"
            >
              <span
                class="card-rank"
              >
                ${displayedRank}
              </span>

              <span
                class="card-suit"
              >
                ${card.symbol}
              </span>

              <span
                class="card-corner"
              >
                ${displayedRank}${card.symbol}
              </span>
            </button>
          `;
    })
    .join('');

  playerHandElement.querySelectorAll('.playing-card').forEach((cardElement) => {
    cardElement.addEventListener('click', () => {
      const cardId = cardElement.dataset.cardId;

      if (selectedCardIds.includes(cardId)) {
        selectedCardIds = selectedCardIds.filter((id) => id !== cardId);
      } else {
        selectedCardIds.push(cardId);
      }

      renderHand();

      updateActionUI();
    });
  });
}

/* =========================================================
   CENTER TABLE
   ========================================================= */

function renderCenter() {
  if (!roomState) {
    return;
  }

  const state = roomState.state;

  if (!state.hasStarted) {
    turnIndicatorElement.textContent = state.dealtAt
      ? 'Game finished'
      : 'Waiting to deal';
  } else if (state.paused) {
    turnIndicatorElement.textContent = 'Game paused — waiting for all players';
  } else if (state.phase === 'showing-play') {
    const lead = state.currentLead;

    if (lead) {
      const player = roomState.players[lead.playerIndex];

      turnIndicatorElement.textContent = `${player.name} played`;
    } else {
      turnIndicatorElement.textContent = 'Play resolving…';
    }
  } else {
    const turnPlayer = roomState.players[state.currentPlayerIndex];

    turnIndicatorElement.textContent = `${turnPlayer.name}'s Turn`;
  }

  /*
    The current lead stays visible
    after the 2-second delay because
    the next player must respond to it.
  */
  if (state.currentLead) {
    const lead = state.currentLead;

    const leader = roomState.players[lead.playerIndex];

    currentPlayElement.innerHTML = `
      <div class="played-cards">
        ${lead.cards
          .map((card) => {
            const displayedRank = card.displayRank ?? card.rank;

            return `
                <div
                  class="mini-card ${card.color}"
                >
                  <strong>
                    ${displayedRank}
                  </strong>

                  <span>
                    ${card.symbol}
                  </span>
                </div>
              `;
          })
          .join('')}
      </div>
    `;

    lastPlayerElement.textContent = `${leader.name}: ${lead.combination.label}`;
  } else {
    currentPlayElement.innerHTML = `
      <div class="empty-play">
        <span>
          ${state.hasStarted ? 'New Lead' : 'No active play'}
        </span>
      </div>
    `;

    lastPlayerElement.textContent = state.hasStarted
      ? 'Awaiting lead...'
      : 'No previous play';
  }
}

/* =========================================================
   BUTTON STATE
   ========================================================= */

function updateActionUI() {
  selectedCountElement.textContent = selectedCardIds.length;

  const state = roomState?.state;

  const activeGame = Boolean(state?.hasStarted);

  const normalTurn = activeGame && !state.paused && state.phase === 'turn';

  const myTurn =
    normalTurn &&
    localSeatIndex !== null &&
    state.currentPlayerIndex === localSeatIndex;

  playButton.disabled = !myTurn || selectedCardIds.length === 0;

  passButton.disabled = !myTurn || !state?.currentLead;

  sortButton.disabled = !activeGame;
}

/* =========================================================
   FULL RENDER
   ========================================================= */

function renderGame() {
  if (!roomState || localSeatIndex === null) {
    return;
  }

  roomCodeDisplay.textContent = roomState.code;

  dealButton.style.display = localSeatIndex === 0 ? '' : 'none';

  renderPlayerSeats();

  renderHand();

  renderCenter();

  updateActionUI();
}

/* =========================================================
   SOCKET CONNECTION STATUS
   ========================================================= */

socket.on('connect', () => {
  connectionStatus.textContent = 'Connected';

  connectionStatus.classList.add('connected');
});

socket.on('disconnect', () => {
  connectionStatus.textContent = 'Disconnected from server';

  connectionStatus.classList.remove('connected');
});

socket.on('connect_error', (error) => {
  connectionStatus.textContent = `Connection error: ${error.message}`;

  connectionStatus.classList.remove('connected');
});

/* =========================================================
   SERVER STATE
   ========================================================= */

socket.on('roomStateUpdate', (data) => {
  applyRoomState(data);
});

socket.on('gameStateUpdate', (data) => {
  applyRoomState(data);
});

socket.on('toast', (message) => {
  showToast(message);
});

/* =========================================================
   ROOM CLOSED BY HOST EXIT
   ========================================================= */

socket.on('roomClosed', ({ reason } = {}) => {
  roomState = null;

  localSeatIndex = null;

  selectedCardIds = [];

  lastRevision = -1;

  roomCodeDisplay.textContent = '------';

  dealTimeDisplay.textContent = 'Not dealt';

  playerSeatsElement.innerHTML = '';

  playerHandElement.innerHTML = `
        <div class="empty-hand">
          Room closed.
        </div>
      `;

  currentPlayElement.innerHTML = `
        <div class="empty-play">
          <span>
            No active play
          </span>
        </div>
      `;

  turnIndicatorElement.textContent = 'Room closed';

  lastPlayerElement.textContent = 'No previous play';

  roomModal.classList.remove('hidden');

  showToast(
    reason === 'host_disconnected'
      ? 'Room closed because the host left.'
      : 'Room closed.'
  );
});

/* =========================================================
   CREATE ROOM
   ========================================================= */

createRoomBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim() || 'Player 1';

  socket.emit(
    'createRoom',
    {
      name,
    },
    (response) => {
      if (!response?.success) {
        showToast(response?.message || 'Could not create room.');

        return;
      }

      localSeatIndex = response.seatIndex;

      lastRevision = -1;

      roomCodeDisplay.textContent = response.roomCode;

      roomModal.classList.add('hidden');
    }
  );
});

/* =========================================================
   JOIN / REJOIN ROOM
   ========================================================= */

joinRoomBtn.addEventListener('click', () => {
  const name = playerNameInput.value.trim();

  const roomCode = roomCodeInput.value.trim().toUpperCase();

  const seatIndex = Number.parseInt(seatSelect.value, 10);

  if (!roomCode) {
    showToast('Enter a room code.');

    return;
  }

  socket.emit(
    'joinRoom',
    {
      roomCode,
      seatIndex,
      name,
    },
    (response) => {
      if (!response?.success) {
        showToast(response?.message || 'Could not join room.');

        return;
      }

      localSeatIndex = response.seatIndex;

      lastRevision = -1;

      roomCodeDisplay.textContent = response.roomCode;

      roomModal.classList.add('hidden');
    }
  );
});

/* =========================================================
   DEAL
   ========================================================= */

dealButton.addEventListener('click', () => {
  const confirmed =
    !roomState?.state?.hasStarted ||
    window.confirm('Start a new game and reshuffle all cards?');

  if (!confirmed) {
    return;
  }

  socket.emit('dealCards', (response) => {
    if (!response?.success) {
      showToast(response?.message || 'Could not deal cards.');

      return;
    }

    selectedCardIds = [];
  });
});

/* =========================================================
   PLAY
   ========================================================= */

playButton.addEventListener('click', () => {
  socket.emit(
    'playCards',
    {
      cardIds: selectedCardIds,
    },
    (response) => {
      if (!response?.success) {
        showToast(response?.message || 'Invalid play.');

        return;
      }

      selectedCardIds = [];
    }
  );
});

/* =========================================================
   PASS
   ========================================================= */

passButton.addEventListener('click', () => {
  socket.emit('passTurn', (response) => {
    if (!response?.success) {
      showToast(response?.message || 'Could not pass.');

      return;
    }

    selectedCardIds = [];
  });
});

/* =========================================================
   SORT
   ========================================================= */

sortButton.addEventListener('click', () => {
  if (!roomState?.state?.hasStarted || localSeatIndex === null) {
    return;
  }

  roomState.state.hands[localSeatIndex] = sortCards(getLocalHand());

  renderHand();

  updateActionUI();
});

/* =========================================================
   ROOM CODE INPUT
   ========================================================= */

roomCodeInput.addEventListener('input', () => {
  roomCodeInput.value = roomCodeInput.value.toUpperCase();
});

/* =========================================================
   ASK / REPORT
   ========================================================= */

document.querySelector('#ask-button').addEventListener('click', () => {
  showToast('Ask/report networking is not implemented yet.');
});

reportButton.addEventListener('click', () => {
  reportModal.classList.remove('hidden');
});

closeReportModalButton.addEventListener('click', () => {
  reportModal.classList.add('hidden');
});

reportModal.addEventListener('click', (event) => {
  if (event.target === reportModal) {
    reportModal.classList.add('hidden');
  }
});

document.querySelector('#report-count-button').addEventListener('click', () => {
  reportModal.classList.add('hidden');

  showToast('Reporting is not synchronized yet.');
});

document.querySelector('#report-route-button').addEventListener('click', () => {
  reportModal.classList.add('hidden');

  showToast('Route reporting is not implemented yet.');
});

/* =========================================================
   MENU
   ========================================================= */

document.querySelector('#menu-button').addEventListener('click', () => {
  showToast('Settings will be added later.');
});
