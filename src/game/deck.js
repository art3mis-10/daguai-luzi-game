const SUITS = [
  {
    name: 'spades',
    symbol: '♠',
    color: 'black',
  },
  {
    name: 'hearts',
    symbol: '♥',
    color: 'red',
  },
  {
    name: 'clubs',
    symbol: '♣',
    color: 'black',
  },
  {
    name: 'diamonds',
    symbol: '♦',
    color: 'red',
  },
];

const RANKS = [
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

const SORT_ORDER = [
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
  'small-joker',
  'big-joker',
];

/**
 * Creates three complete 54-card decks.
 *
 * Each physical card receives a unique ID because Daguai uses
 * three decks and therefore contains duplicate ranks and suits.
 */
export function createThreeDecks() {
  const cards = [];

  for (let deckNumber = 1; deckNumber <= 3; deckNumber += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({
          id: `deck-${deckNumber}-${suit.name}-${rank}`,
          deckNumber,
          rank,
          suit: suit.name,
          symbol: suit.symbol,
          color: suit.color,
          isJoker: false,
        });
      }
    }

    cards.push({
      id: `deck-${deckNumber}-small-joker`,
      deckNumber,
      rank: 'small-joker',
      displayRank: 'SJ',
      suit: null,
      symbol: '★',
      color: 'black',
      isJoker: true,
      jokerType: 'small',
    });

    cards.push({
      id: `deck-${deckNumber}-big-joker`,
      deckNumber,
      rank: 'big-joker',
      displayRank: 'BJ',
      suit: null,
      symbol: '★',
      color: 'red',
      isJoker: true,
      jokerType: 'big',
    });
  }

  return cards;
}

/**
 * Fisher-Yates shuffle.
 *
 * The original array is not modified.
 */
export function shuffleCards(cards) {
  const shuffledCards = [...cards];

  for (
    let currentIndex = shuffledCards.length - 1;
    currentIndex > 0;
    currentIndex -= 1
  ) {
    const randomIndex = Math.floor(Math.random() * (currentIndex + 1));

    const temporaryCard = shuffledCards[currentIndex];

    shuffledCards[currentIndex] = shuffledCards[randomIndex];

    shuffledCards[randomIndex] = temporaryCard;
  }

  return shuffledCards;
}

/**
 * Deals all cards clockwise into six hands.
 *
 * 162 cards / 6 players = 27 cards per player.
 */
export function dealCards(cards, numberOfPlayers = 6) {
  if (cards.length % numberOfPlayers !== 0) {
    throw new Error(
      `Cannot evenly deal ${cards.length} cards to ${numberOfPlayers} players.`
    );
  }

  const hands = Array.from({ length: numberOfPlayers }, () => []);

  cards.forEach((card, cardIndex) => {
    const playerIndex = cardIndex % numberOfPlayers;
    hands[playerIndex].push(card);
  });

  return hands;
}

/**
 * Sorts cards for visual display.
 *
 * This is only a temporary natural sorting system.
 * Later, it will take the current trump rank into account.
 */
export function sortCards(cards) {
  return [...cards].sort((cardA, cardB) => {
    const rankDifference =
      SORT_ORDER.indexOf(cardA.rank) - SORT_ORDER.indexOf(cardB.rank);

    if (rankDifference !== 0) {
      return rankDifference;
    }

    const suitOrder = ['spades', 'hearts', 'clubs', 'diamonds'];

    return suitOrder.indexOf(cardA.suit) - suitOrder.indexOf(cardB.suit);
  });
}

/**
 * Creates, shuffles, and deals a complete Daguai deck.
 */
export function createNewDeal() {
  const deck = createThreeDecks();
  const shuffledDeck = shuffleCards(deck);
  const hands = dealCards(shuffledDeck, 6);

  return {
    deck,
    shuffledDeck,
    hands,
  };
}
