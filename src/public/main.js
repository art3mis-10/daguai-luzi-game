import {
  sortCards,
} from '/game/deck.js';

const socket =
  window.io();

let localSeatIndex =
  null;

let roomState =
  null;

let selectedCardIds =
  [];

let lastRevision =
  -1;

/* =========================================================
   APP HTML
   ========================================================= */

document.querySelector(
  '#app'
).innerHTML = `
  <!-- ===================================================
       LOBBY
       =================================================== -->

  <div
    id="room-modal"
    class="modal-backdrop"
  >
    <div
      class="modal lobby-modal"
    >
      <div class="modal-header">
        <h2>
          Daguai Luzi Online Lobby
        </h2>
      </div>

      <p>
        Create a room as Player 1,
        or join an existing room.
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

  <!-- ===================================================
       GAME
       =================================================== -->

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
      </div>

      <div class="top-actions">
        <label
          class="record-toggle"
          id="random-record-control"
          title="Choose whether the next random Deal is saved to research history"
        >
          <input
            type="checkbox"
            id="record-game-checkbox"
            checked
          />

          <span class="record-toggle-copy">
            <strong>
              Record
            </strong>

            <small>
              next game
            </small>
          </span>
        </label>

        <div
          class="recording-badge idle"
          id="recording-status"
        >
          No game
        </div>

        <button
          class="deal-button"
          id="deal-button"
        >
          Deal
        </button>

        <button
          class="deal-button"
          id="custom-deal-button"
        >
          Custom Deal
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
  </div>

  <!-- ===================================================
       ASK MODAL
       =================================================== -->

  <div
    class="modal-backdrop hidden"
    id="ask-modal"
  >
    <div
      class="modal"
      style="width: min(480px, 96vw);"
    >
      <div class="modal-header">
        <h2>
          Ask Card Count
        </h2>

        <button
          class="close-button"
          id="close-ask-modal"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <p>
        You may ask any other player at any time.
        A player with 10 cards or fewer reports
        the exact number. Otherwise the public
        response is "Not reported".
      </p>

      <div
        id="ask-player-list"
      >
      </div>
    </div>
  </div>

  <!-- ===================================================
       CUSTOM DEAL MODAL
       =================================================== -->

  <div
    class="modal-backdrop hidden"
    id="custom-deal-modal"
  >
    <div
      class="modal"
      style="
        width: min(820px, 96vw);
        max-height: 92vh;
        overflow-y: auto;
      "
    >
      <div class="modal-header">
        <h2>
          Custom Deal
        </h2>

        <button
          class="close-button"
          id="close-custom-deal-modal"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      <p>
        Enter each player's hand manually.
        Use card codes such as
        AS, KH, 10D, QC, BJ and SJ.
        Repeat a code to use another copy
        from the three decks.
      </p>

      <div
        style="
          padding: 10px 12px;
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 10px;
          background: rgba(255,255,255,0.035);
          color: #a6b2ac;
          font-size: 11px;
          line-height: 1.7;
          margin-bottom: 14px;
        "
      >
        <strong style="color:#f1c86f;">
          Card notation
        </strong>
        <br />
        S = Spades · H = Hearts ·
        C = Clubs · D = Diamonds
        <br />
        BJ = Big Joker · SJ = Small Joker
        <br />
        Example:
        AS AS 10H 10H QC BJ
      </div>

      <div
        id="custom-hand-fields"
        style="
          display: grid;
          grid-template-columns:
            repeat(2, minmax(0, 1fr));
          gap: 10px;
        "
      >
      </div>

      <div
        style="
          display: grid;
          grid-template-columns:
            repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-top: 16px;
        "
      >
        <div>
          <label
            class="field-label"
            for="custom-trump-rank"
          >
            Trump rank
          </label>

          <select
            class="text-input"
            id="custom-trump-rank"
          >
            <option>2</option>
            <option>3</option>
            <option>4</option>
            <option>5</option>
            <option>6</option>
            <option>7</option>
            <option>8</option>
            <option>9</option>
            <option>10</option>
            <option>J</option>
            <option>Q</option>
            <option>K</option>
            <option>A</option>
          </select>
        </div>

        <div>
          <label
            class="field-label"
            for="custom-start-player"
          >
            Starting player
          </label>

          <select
            class="text-input"
            id="custom-start-player"
          >
          </select>
        </div>

        <div>
          <label
            class="field-label"
            for="custom-finish-order"
          >
            Finished order
          </label>

          <input
            class="text-input"
            id="custom-finish-order"
            placeholder="e.g. 3, 1"
          />
        </div>
      </div>

      <p
        style="
          margin-top: 12px;
          margin-bottom: 10px;
        "
      >
        If a player has already finished,
        leave their hand empty and list their
        player number in Finished order.
        Example: <strong>3, 1</strong> means
        Player 3 finished first and Player 1
        finished second.
      </p>

      <label
        class="custom-record-option"
        for="custom-record-game-checkbox"
      >
        <input
          type="checkbox"
          id="custom-record-game-checkbox"
          checked
        />

        <span>
          <strong>
            Record this custom game
          </strong>

          <small>
            Save hands, actions, finish order and result to research history.
          </small>
        </span>
      </label>

      <button
        class="primary-button full-width"
        id="start-custom-deal-button"
      >
        Start Custom Game
      </button>
    </div>
  </div>
`;

/* =========================================================
   DOM REFERENCES
   ========================================================= */

const roomModal =
  document.querySelector(
    '#room-modal'
  );

const createRoomBtn =
  document.querySelector(
    '#create-room-btn'
  );

const joinRoomBtn =
  document.querySelector(
    '#join-room-btn'
  );

const playerNameInput =
  document.querySelector(
    '#player-name-input'
  );

const roomCodeInput =
  document.querySelector(
    '#room-code-input'
  );

const seatSelect =
  document.querySelector(
    '#seat-select'
  );

const connectionStatus =
  document.querySelector(
    '#connection-status'
  );

const roomCodeDisplay =
  document.querySelector(
    '#room-code-display'
  );

const trumpRankDisplay =
  document.querySelector(
    '#trump-rank-display'
  );

const dealTimeDisplay =
  document.querySelector(
    '#deal-time-display'
  );

const playerSeatsElement =
  document.querySelector(
    '#player-seats'
  );

const playerHandElement =
  document.querySelector(
    '#player-hand'
  );

const selectedCountElement =
  document.querySelector(
    '#selected-count'
  );

const dealButton =
  document.querySelector(
    '#deal-button'
  );

const customDealButton =
  document.querySelector(
    '#custom-deal-button'
  );

const randomRecordControl =
  document.querySelector(
    '#random-record-control'
  );

const recordGameCheckbox =
  document.querySelector(
    '#record-game-checkbox'
  );

const recordingStatus =
  document.querySelector(
    '#recording-status'
  );

const ownCardCountElement =
  document.querySelector(
    '#own-card-count'
  );

const playButton =
  document.querySelector(
    '#play-button'
  );

const passButton =
  document.querySelector(
    '#pass-button'
  );

const sortButton =
  document.querySelector(
    '#sort-button'
  );

const askButton =
  document.querySelector(
    '#ask-button'
  );

const currentPlayElement =
  document.querySelector(
    '#current-play'
  );

const lastPlayerElement =
  document.querySelector(
    '#last-player'
  );

const turnIndicatorElement =
  document.querySelector(
    '#turn-indicator'
  );

const toastElement =
  document.querySelector(
    '#toast'
  );

const activePlayerNameElement =
  document.querySelector(
    '#active-player-name'
  );

const activePlayerTeamElement =
  document.querySelector(
    '#active-player-team'
  );

const activePlayerAvatarElement =
  document.querySelector(
    '#active-player-avatar'
  );

/* Ask modal */

const askModal =
  document.querySelector(
    '#ask-modal'
  );

const closeAskModalButton =
  document.querySelector(
    '#close-ask-modal'
  );

const askPlayerList =
  document.querySelector(
    '#ask-player-list'
  );

/* Custom modal */

const customDealModal =
  document.querySelector(
    '#custom-deal-modal'
  );

const closeCustomDealModalButton =
  document.querySelector(
    '#close-custom-deal-modal'
  );

const customHandFields =
  document.querySelector(
    '#custom-hand-fields'
  );

const customTrumpRank =
  document.querySelector(
    '#custom-trump-rank'
  );

const customStartPlayer =
  document.querySelector(
    '#custom-start-player'
  );

const customFinishOrder =
  document.querySelector(
    '#custom-finish-order'
  );

const customRecordGameCheckbox =
  document.querySelector(
    '#custom-record-game-checkbox'
  );

const startCustomDealButton =
  document.querySelector(
    '#start-custom-deal-button'
  );

/* =========================================================
   HELPERS
   ========================================================= */

function escapeHtml(
  value
) {
  return String(value)
    .replaceAll(
      '&',
      '&amp;'
    )
    .replaceAll(
      '<',
      '&lt;'
    )
    .replaceAll(
      '>',
      '&gt;'
    )
    .replaceAll(
      '"',
      '&quot;'
    )
    .replaceAll(
      "'",
      '&#039;'
    );
}

function showToast(
  message
) {
  toastElement.textContent =
    message;

  toastElement.classList.add(
    'visible'
  );

  window.clearTimeout(
    showToast.timeoutId
  );

  showToast.timeoutId =
    window.setTimeout(
      () => {
        toastElement
          .classList
          .remove(
            'visible'
          );
      },
      2800
    );
}

function formatDealTime(
  timestamp
) {
  if (!timestamp) {
    return 'Not dealt';
  }

  return new Intl.DateTimeFormat(
    undefined,
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }
  ).format(
    new Date(timestamp)
  );
}

function getPositionForOffset(
  offset
) {
  const positions = {
    1:
      'bottom-left',

    2:
      'top-left',

    3:
      'top',

    4:
      'top-right',

    5:
      'bottom-right',
  };

  return positions[
    offset
  ];
}

function getLocalHand() {
  if (
    !roomState ||
    localSeatIndex ===
      null
  ) {
    return [];
  }

  return (
    roomState.state.hands[
      localSeatIndex
    ] || []
  );
}

function getPublicReportText(
  seatIndex
) {
  const report =
    roomState?.state
      ?.publicReports?.[
        seatIndex
      ];

  if (!report) {
    return 'Card count unknown';
  }

  if (
    report.status ===
    'not-reported'
  ) {
    return 'Not reported';
  }

  if (
    report.status ===
    'reported'
  ) {
    return `${report.count} card${
      report.count === 1
        ? ''
        : 's'
    }`;
  }

  return 'Card count unknown';
}

/* =========================================================
   REVISION SAFE STATE
   ========================================================= */

function applyRoomState(
  data
) {
  const incomingRevision =
    data?.state
      ?.revision ??
    -1;

  if (
    roomState &&
    data.code ===
      roomState.code &&
    incomingRevision <
      lastRevision
  ) {
    return;
  }

  lastRevision =
    incomingRevision;

  roomState =
    data;

  renderGame();

  if (
    !askModal.classList
      .contains(
        'hidden'
      )
  ) {
    renderAskPlayerList();
  }
}

/* =========================================================
   OTHER PLAYERS
   ========================================================= */

function renderPlayerSeats() {
  if (
    !roomState ||
    localSeatIndex ===
      null
  ) {
    playerSeatsElement
      .innerHTML =
      '';

    return;
  }

  const markup =
    [];

  for (
    let offset = 1;
    offset <= 5;
    offset += 1
  ) {
    const playerIndex =
      (
        localSeatIndex +
        offset
      ) % 6;

    const player =
      roomState.players[
        playerIndex
      ];

    const position =
      getPositionForOffset(
        offset
      );

    let statusText =
      getPublicReportText(
        playerIndex
      );

    if (
      !roomState.state
        .gameId
    ) {
      statusText =
        player.connected
          ? 'Ready'
          : 'Empty';
    }

    if (
      !player.connected
    ) {
      statusText =
        roomState.state
          .gameId
          ? `Disconnected · ${statusText}`
          : 'Empty';
    }

    if (
      player.hasFinished
    ) {
      statusText =
        'Finished · 0 cards';
    }

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
            ${escapeHtml(
              player.name
            )}
          </strong>

          <span
            class="player-status"
          >
            ${statusText}
          </span>
        </div>

        ${
          player.connected &&
          !player.hasFinished
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

  playerSeatsElement
    .innerHTML =
    markup.join('');
}

/* =========================================================
   LOCAL HAND
   ========================================================= */

function renderHand() {
  if (
    !roomState ||
    localSeatIndex ===
      null
  ) {
    return;
  }

  const player =
    roomState.players[
      localSeatIndex
    ];

  const hand =
    getLocalHand();

  activePlayerNameElement
    .textContent =
    player.name;

  activePlayerTeamElement
    .textContent =
    `Team ${player.team}`;

  activePlayerAvatarElement
    .textContent =
    player.id;

  activePlayerAvatarElement
    .className =
    `player-avatar team-${player.team.toLowerCase()} current`;

  trumpRankDisplay
    .textContent =
    roomState.state
      .trumpRank;

  dealTimeDisplay
    .textContent =
    formatDealTime(
      roomState.state
        .dealtAt
    );

  const availableIds =
    new Set(
      hand.map(
        (card) =>
          card.id
      )
    );

  selectedCardIds =
    selectedCardIds.filter(
      (id) =>
        availableIds.has(
          id
        )
    );

  if (
    !roomState.state
      .gameId
  ) {
    playerHandElement.innerHTML = `
      <div class="empty-hand">
        Waiting for Player 1 to deal.
      </div>
    `;

    ownCardCountElement
      .textContent =
      '0 cards';

    return;
  }

  ownCardCountElement
    .textContent =
    `${hand.length} cards`;

  if (
    hand.length === 0
  ) {
    playerHandElement.innerHTML = `
      <div class="empty-hand">
        You have finished.
      </div>
    `;

    return;
  }

  playerHandElement
    .innerHTML =
    hand
      .map(
        (card) => {
          const selected =
            selectedCardIds.includes(
              card.id
            );

          const displayedRank =
            card.displayRank ??
            card.rank;

          return `
            <button
              class="
                playing-card
                ${card.color}
                ${
                  selected
                    ? 'selected'
                    : ''
                }
                ${
                  card.isJoker
                    ? 'joker-card'
                    : ''
                }
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
        }
      )
      .join('');

  playerHandElement
    .querySelectorAll(
      '.playing-card'
    )
    .forEach(
      (
        cardElement
      ) => {
        cardElement
          .addEventListener(
            'click',
            () => {
              const cardId =
                cardElement
                  .dataset
                  .cardId;

              if (
                selectedCardIds.includes(
                  cardId
                )
              ) {
                selectedCardIds =
                  selectedCardIds.filter(
                    (id) =>
                      id !==
                      cardId
                  );
              } else {
                selectedCardIds.push(
                  cardId
                );
              }

              renderHand();

              updateActionUI();
            }
          );
      }
    );
}

/* =========================================================
   CENTER
   ========================================================= */

function renderCenter() {
  if (!roomState) {
    return;
  }

  const state =
    roomState.state;

  if (
    !state.gameId
  ) {
    turnIndicatorElement
      .textContent =
      'Waiting to deal';
  } else if (
    !state.hasStarted
  ) {
    turnIndicatorElement
      .textContent =
      state.winnerTeam
        ? `Team ${state.winnerTeam} wins`
        : 'Game finished';
  } else if (
    state.paused
  ) {
    turnIndicatorElement
      .textContent =
      'Game paused — waiting for players';
  } else if (
    state.phase ===
    'showing-play'
  ) {
    const lead =
      state.currentLead;

    if (lead) {
      const player =
        roomState.players[
          lead.playerIndex
        ];

      turnIndicatorElement
        .textContent =
        `${player.name} played`;
    }
  } else {
    const turnPlayer =
      roomState.players[
        state.currentPlayerIndex
      ];

    turnIndicatorElement
      .textContent =
      `${turnPlayer.name}'s Turn`;
  }

  if (
    state.currentLead
  ) {
    const lead =
      state.currentLead;

    const leader =
      roomState.players[
        lead.playerIndex
      ];

    currentPlayElement
      .innerHTML = `
        <div class="played-cards">
          ${lead.cards
            .map(
              (card) => {
                const displayedRank =
                  card.displayRank ??
                  card.rank;

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
              }
            )
            .join('')}
        </div>
      `;

    lastPlayerElement
      .textContent =
      `${leader.name}: ${lead.combination.label}`;
  } else {
    currentPlayElement
      .innerHTML = `
        <div class="empty-play">
          <span>
            ${
              state.hasStarted
                ? 'New Lead'
                : 'No active play'
            }
          </span>
        </div>
      `;

    lastPlayerElement
      .textContent =
      state.hasStarted
        ? 'Awaiting lead...'
        : 'No previous play';
  }
}

/* =========================================================
   ACTION UI
   ========================================================= */

function updateActionUI() {
  selectedCountElement
    .textContent =
    selectedCardIds.length;

  const state =
    roomState?.state;

  const activeGame =
    Boolean(
      state?.hasStarted
    );

  const normalTurn =
    activeGame &&
    !state.paused &&
    state.phase ===
      'turn';

  const myTurn =
    normalTurn &&
    localSeatIndex !==
      null &&
    state.currentPlayerIndex ===
      localSeatIndex;

  playButton.disabled =
    !myTurn ||
    selectedCardIds.length ===
      0;

  passButton.disabled =
    !myTurn ||
    !state?.currentLead;

  sortButton.disabled =
    !state?.gameId;

  /*
    Ask is independent of turn,
    but only while the game is active.
  */
  askButton.disabled =
    !state?.hasStarted;
}

/* =========================================================
   FULL RENDER
   ========================================================= */

function renderGame() {
  if (
    !roomState ||
    localSeatIndex ===
      null
  ) {
    return;
  }

  roomCodeDisplay
    .textContent =
    roomState.code;

  const isHost =
    localSeatIndex ===
    0;

  dealButton.style.display =
    isHost
      ? ''
      : 'none';

  customDealButton.style.display =
    isHost
      ? ''
      : 'none';

  randomRecordControl.style.display =
    isHost
      ? ''
      : 'none';

  const state =
    roomState.state;

  if (
    !state.gameId
  ) {
    recordingStatus
      .textContent =
      'No game';

    recordingStatus
      .className =
      'recording-badge idle';
  } else if (
    state.recordGame ===
    false
  ) {
    recordingStatus
      .textContent =
      'Not recording';

    recordingStatus
      .className =
      'recording-badge off';
  } else {
    recordingStatus
      .textContent =
      'Recording';

    recordingStatus
      .className =
      'recording-badge on';
  }

  renderPlayerSeats();

  renderHand();

  renderCenter();

  updateActionUI();
}

/* =========================================================
   ASK MODAL
   ========================================================= */

function renderAskPlayerList() {
  if (
    !roomState ||
    localSeatIndex ===
      null
  ) {
    return;
  }

  const rows =
    [];

  roomState.players.forEach(
    (
      player,
      seatIndex
    ) => {
      if (
        seatIndex ===
        localSeatIndex
      ) {
        return;
      }

      const reportText =
        getPublicReportText(
          seatIndex
        );

      rows.push(`
        <div
          style="
            display: grid;
            grid-template-columns: 1fr auto;
            align-items: center;
            gap: 12px;
            padding: 10px 0;
            border-bottom:
              1px solid
              rgba(255,255,255,0.07);
          "
        >
          <div>
            <strong
              style="
                display:block;
                font-size:13px;
              "
            >
              Player ${player.id} ·
              ${escapeHtml(player.name)}
            </strong>

            <span
              style="
                display:block;
                color:#8ea197;
                font-size:11px;
                margin-top:3px;
              "
            >
              Team ${player.team} ·
              ${reportText}
            </span>
          </div>

          <button
            class="secondary-button ask-target-button"
            data-target-seat="${seatIndex}"
          >
            Ask
          </button>
        </div>
      `);
    }
  );

  askPlayerList.innerHTML =
    rows.join('');

  askPlayerList
    .querySelectorAll(
      '.ask-target-button'
    )
    .forEach(
      (button) => {
        button
          .addEventListener(
            'click',
            () => {
              const targetSeatIndex =
                Number(
                  button
                    .dataset
                    .targetSeat
                );

              socket.emit(
                'askCardCount',

                {
                  targetSeatIndex,
                },

                (response) => {
                  if (
                    !response
                      ?.success
                  ) {
                    showToast(
                      response
                        ?.message ||
                      'Could not ask player.'
                    );
                  }
                }
              );
            }
          );
      }
    );
}

askButton
  .addEventListener(
    'click',
    () => {
      if (
        !roomState?.state
          ?.gameId
      ) {
        showToast(
          'Deal the cards first.'
        );

        return;
      }

      renderAskPlayerList();

      askModal
        .classList
        .remove(
          'hidden'
        );
    }
  );

closeAskModalButton
  .addEventListener(
    'click',
    () => {
      askModal
        .classList
        .add(
          'hidden'
        );
    }
  );

askModal
  .addEventListener(
    'click',
    (event) => {
      if (
        event.target ===
        askModal
      ) {
        askModal
          .classList
          .add(
            'hidden'
          );
      }
    }
  );

/* =========================================================
   CUSTOM DEAL MODAL
   ========================================================= */

function populateCustomDealModal() {
  if (!roomState) {
    return;
  }

  customHandFields
    .innerHTML =
    roomState.players
      .map(
        (
          player,
          seatIndex
        ) => `
          <div>
            <label
              class="field-label"
              for="custom-hand-${seatIndex}"
            >
              Player ${player.id} ·
              ${escapeHtml(player.name)} ·
              Team ${player.team}
            </label>

            <textarea
              class="text-input"
              id="custom-hand-${seatIndex}"
              rows="4"
              placeholder="AS KH 10D 10D BJ"
              style="
                resize: vertical;
                min-height: 92px;
                line-height: 1.5;
              "
            ></textarea>
          </div>
        `
      )
      .join('');

  customStartPlayer
    .innerHTML =
    roomState.players
      .map(
        (
          player,
          seatIndex
        ) => `
          <option
            value="${seatIndex}"
          >
            Player ${player.id} ·
            ${escapeHtml(player.name)}
          </option>
        `
      )
      .join('');

  customTrumpRank.value =
    roomState.state
      .trumpRank ||
    '2';

  customStartPlayer.value =
    '0';

  customFinishOrder.value =
    '';

  /*
    Every Custom Deal starts with recording ON.
    A previous game's choice is never inherited.
  */
  customRecordGameCheckbox.checked =
    true;
}

customDealButton
  .addEventListener(
    'click',
    () => {
      if (
        localSeatIndex !==
        0
      ) {
        return;
      }

      populateCustomDealModal();

      customDealModal
        .classList
        .remove(
          'hidden'
        );
    }
  );

closeCustomDealModalButton
  .addEventListener(
    'click',
    () => {
      customDealModal
        .classList
        .add(
          'hidden'
        );
    }
  );

customDealModal
  .addEventListener(
    'click',
    (event) => {
      if (
        event.target ===
        customDealModal
      ) {
        customDealModal
          .classList
          .add(
            'hidden'
          );
      }
    }
  );

startCustomDealButton
  .addEventListener(
    'click',
    () => {
      if (
        localSeatIndex !==
        0
      ) {
        return;
      }

      const handTexts =
        Array.from(
          {
            length: 6,
          },

          (
            _value,
            seatIndex
          ) =>
            document
              .querySelector(
                `#custom-hand-${seatIndex}`
              )
              ?.value ??
            ''
        );

      const confirmed =
        !roomState?.state
          ?.hasStarted ||
        window.confirm(
          'Replace the current game with this custom deal?'
        );

      if (!confirmed) {
        return;
      }

      startCustomDealButton
        .disabled =
        true;

      socket.emit(
        'customDeal',

        {
          handTexts,

          trumpRank:
            customTrumpRank
              .value,

          startingPlayerIndex:
            Number(
              customStartPlayer
                .value
            ),

          finishOrderText:
            customFinishOrder
              .value,

          recordGame:
            customRecordGameCheckbox
              .checked,
        },

        (response) => {
          startCustomDealButton
            .disabled =
            false;

          if (
            !response
              ?.success
          ) {
            showToast(
              response
                ?.message ||
              'Could not start custom game.'
            );

            return;
          }

          selectedCardIds =
            [];

          customDealModal
            .classList
            .add(
              'hidden'
            );

          const recordingText =
            response.recorded ===
            false
              ? 'Not recording.'
              : 'Recording confirmed.';

          showToast(
            `Custom game started. ${response.unassignedCardCount} cards unassigned. ${recordingText}`
          );

          /*
            Default the NEXT Custom Deal back to recording ON.
          */
          customRecordGameCheckbox.checked =
            true;
        }
      );
    }
  );

/* =========================================================
   SOCKET CONNECTION STATUS
   ========================================================= */

socket.on(
  'connect',
  () => {
    connectionStatus
      .textContent =
      'Connected';

    connectionStatus
      .classList
      .add(
        'connected'
      );
  }
);

socket.on(
  'disconnect',
  () => {
    connectionStatus
      .textContent =
      'Disconnected from server';

    connectionStatus
      .classList
      .remove(
        'connected'
      );
  }
);

socket.on(
  'connect_error',
  (error) => {
    connectionStatus
      .textContent =
      `Connection error: ${error.message}`;

    connectionStatus
      .classList
      .remove(
        'connected'
      );
  }
);

/* =========================================================
   SERVER STATE EVENTS
   ========================================================= */

socket.on(
  'roomStateUpdate',
  (data) => {
    applyRoomState(
      data
    );
  }
);

socket.on(
  'gameStateUpdate',
  (data) => {
    applyRoomState(
      data
    );
  }
);

socket.on(
  'toast',
  (message) => {
    showToast(
      message
    );
  }
);

socket.on(
  'publicMessage',
  (message) => {
    showToast(
      message
    );
  }
);

/* =========================================================
   ROOM CLOSED
   ========================================================= */

socket.on(
  'roomClosed',
  (
    {
      reason,
    } = {}
  ) => {
    roomState =
      null;

    localSeatIndex =
      null;

    selectedCardIds =
      [];

    lastRevision =
      -1;

    roomCodeDisplay
      .textContent =
      '------';

    dealTimeDisplay
      .textContent =
      'Not dealt';

    playerSeatsElement
      .innerHTML =
      '';

    playerHandElement
      .innerHTML = `
        <div class="empty-hand">
          Room closed.
        </div>
      `;

    currentPlayElement
      .innerHTML = `
        <div class="empty-play">
          <span>
            No active play
          </span>
        </div>
      `;

    turnIndicatorElement
      .textContent =
      'Room closed';

    lastPlayerElement
      .textContent =
      'No previous play';

    askModal
      .classList
      .add(
        'hidden'
      );

    customDealModal
      .classList
      .add(
        'hidden'
      );

    roomModal
      .classList
      .remove(
        'hidden'
      );

    showToast(
      reason ===
        'host_disconnected'
        ? 'Room closed because the host left.'
        : 'Room closed.'
    );
  }
);

/* =========================================================
   CREATE ROOM
   ========================================================= */

createRoomBtn
  .addEventListener(
    'click',
    () => {
      const name =
        playerNameInput
          .value
          .trim() ||
        'Player 1';

      socket.emit(
        'createRoom',

        {
          name,
        },

        (response) => {
          if (
            !response
              ?.success
          ) {
            showToast(
              response
                ?.message ||
              'Could not create room.'
            );

            return;
          }

          localSeatIndex =
            response
              .seatIndex;

          lastRevision =
            -1;

          roomCodeDisplay
            .textContent =
            response
              .roomCode;

          roomModal
            .classList
            .add(
              'hidden'
            );
        }
      );
    }
  );

/* =========================================================
   JOIN ROOM
   ========================================================= */

joinRoomBtn
  .addEventListener(
    'click',
    () => {
      const name =
        playerNameInput
          .value
          .trim();

      const roomCode =
        roomCodeInput
          .value
          .trim()
          .toUpperCase();

      const seatIndex =
        Number.parseInt(
          seatSelect.value,
          10
        );

      if (!roomCode) {
        showToast(
          'Enter a room code.'
        );

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
          if (
            !response
              ?.success
          ) {
            showToast(
              response
                ?.message ||
              'Could not join room.'
            );

            return;
          }

          localSeatIndex =
            response
              .seatIndex;

          lastRevision =
            -1;

          roomCodeDisplay
            .textContent =
            response
              .roomCode;

          roomModal
            .classList
            .add(
              'hidden'
            );
        }
      );
    }
  );

/* =========================================================
   RANDOM DEAL
   ========================================================= */

dealButton
  .addEventListener(
    'click',
    () => {
      const confirmed =
        !roomState?.state
          ?.hasStarted ||
        window.confirm(
          'Start a new random game and reshuffle all cards?'
        );

      if (!confirmed) {
        return;
      }

      const shouldRecord =
        recordGameCheckbox
          .checked;

      dealButton.disabled =
        true;

      socket.emit(
        'dealCards',

        {
          recordGame:
            shouldRecord,
        },

        (response) => {
          dealButton.disabled =
            false;

          if (
            !response
              ?.success
          ) {
            showToast(
              response
                ?.message ||
              'Could not deal cards.'
            );

            return;
          }

          selectedCardIds =
            [];

          showToast(
            response.recorded ===
              false
              ? 'Game started. Not recording.'
              : 'Game started. Recording confirmed.'
          );

          /*
            Every NEXT random Deal defaults back to recording ON.
          */
          recordGameCheckbox.checked =
            true;
        }
      );
    }
  );

/* =========================================================
   PLAY
   ========================================================= */

playButton
  .addEventListener(
    'click',
    () => {
      socket.emit(
        'playCards',

        {
          cardIds:
            selectedCardIds,
        },

        (response) => {
          if (
            !response
              ?.success
          ) {
            showToast(
              response
                ?.message ||
              'Invalid play.'
            );

            return;
          }

          selectedCardIds =
            [];
        }
      );
    }
  );

/* =========================================================
   PASS
   ========================================================= */

passButton
  .addEventListener(
    'click',
    () => {
      socket.emit(
        'passTurn',

        (response) => {
          if (
            !response
              ?.success
          ) {
            showToast(
              response
                ?.message ||
              'Could not pass.'
            );

            return;
          }

          selectedCardIds =
            [];
        }
      );
    }
  );

/* =========================================================
   SORT
   ========================================================= */

sortButton
  .addEventListener(
    'click',
    () => {
      if (
        !roomState?.state
          ?.gameId ||
        localSeatIndex ===
          null
      ) {
        return;
      }

      roomState.state.hands[
        localSeatIndex
      ] =
        sortCards(
          getLocalHand()
        );

      renderHand();

      updateActionUI();
    }
  );

/* =========================================================
   ROOM CODE
   ========================================================= */

roomCodeInput
  .addEventListener(
    'input',
    () => {
      roomCodeInput.value =
        roomCodeInput
          .value
          .toUpperCase();
    }
  );

/* =========================================================
   MENU
   ========================================================= */

document
  .querySelector(
    '#menu-button'
  )
  .addEventListener(
    'click',
    () => {
      showToast(
        'Settings will be added later.'
      );
    }
  );