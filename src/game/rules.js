const ORDINARY_RANKS_HIGH_TO_LOW = [
  'A',
  'K',
  'Q',
  'J',
  '10',
  '9',
  '8',
  '7',
  '6',
  '5',
  '4',
  '3',
  '2',
];

const STRAIGHT_SEQUENCES = [
  ['A', '2', '3', '4', '5'],
  ['2', '3', '4', '5', '6'],
  ['3', '4', '5', '6', '7'],
  ['4', '5', '6', '7', '8'],
  ['5', '6', '7', '8', '9'],
  ['6', '7', '8', '9', '10'],
  ['7', '8', '9', '10', 'J'],
  ['8', '9', '10', 'J', 'Q'],
  ['9', '10', 'J', 'Q', 'K'],
  ['10', 'J', 'Q', 'K', 'A'],
];

const FIVE_CARD_CATEGORY_STRENGTH = {
  straight: 1,
  flush: 2,
  'full-house': 3,
  'four-plus-one': 4,
  'straight-flush': 5,
  'five-of-a-kind': 6,
};

function isJoker(card) {
  return card.rank === 'small-joker' || card.rank === 'big-joker';
}

function isBigJoker(card) {
  return card.rank === 'big-joker';
}

function isSmallJoker(card) {
  return card.rank === 'small-joker';
}

export function getRankStrength(rank, trumpRank) {
  if (rank === 'big-joker') {
    return 100;
  }

  if (rank === 'small-joker') {
    return 90;
  }

  if (rank === trumpRank) {
    return 80;
  }

  const ordinaryRanks = ORDINARY_RANKS_HIGH_TO_LOW.filter(
    (ordinaryRank) => ordinaryRank !== trumpRank
  );

  const rankIndex = ordinaryRanks.indexOf(rank);

  if (rankIndex === -1) {
    throw new Error(`Unknown rank: ${rank}`);
  }

  return 70 - rankIndex;
}

/*
  Used by Straights and Flushes.

  Trump does NOT receive trump strength here.
  In a Straight or Flush, the printed rank is used normally.
*/
function getOrdinaryRankStrength(rank) {
  const order = [
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

  return order.indexOf(rank);
}

function getStraightStrength(sequence) {
  return STRAIGHT_SEQUENCES.findIndex(
    (candidate) => candidate.join('|') === sequence.join('|')
  );
}

function countRanks(cards) {
  const counts = new Map();

  cards.forEach((card) => {
    if (isJoker(card)) {
      return;
    }

    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  });

  return counts;
}

/* =========================================================
   SINGLE
   ========================================================= */

function classifySingle(cards, trumpRank) {
  const card = cards[0];

  return {
    valid: true,
    type: 'single',
    cardCount: 1,
    primaryRank: card.rank,
    strength: getRankStrength(card.rank, trumpRank),
    cards,
    label: card.displayRank ?? card.rank,
  };
}

/* =========================================================
   PAIR
   ========================================================= */

function classifyPair(cards, trumpRank) {
  const jokers = cards.filter(isJoker);

  const normalCards = cards.filter((card) => !isJoker(card));

  if (
    normalCards.length === 2 &&
    normalCards[0].rank !== normalCards[1].rank
  ) {
    return {
      valid: false,
      reason: 'A pair must contain two cards of the same rank.',
    };
  }

  /*
    One normal card + one Joker.
  */
  if (
    normalCards.length === 1 &&
    jokers.length === 1
  ) {
    const primaryRank =
      normalCards[0].rank;

    return {
      valid: true,
      type: 'pair',
      cardCount: 2,
      primaryRank,

      strength:
        getRankStrength(
          primaryRank,
          trumpRank
        ),

      cards,

      wildAssignments: [
        {
          cardId:
            jokers[0].id,

          substitutedRank:
            primaryRank,
        },
      ],

      label:
        `Pair of ${primaryRank}s`,
    };
  }

  /*
    Natural pair.
  */
  if (
    normalCards.length === 2
  ) {
    const primaryRank =
      normalCards[0].rank;

    return {
      valid: true,
      type: 'pair',
      cardCount: 2,
      primaryRank,

      strength:
        getRankStrength(
          primaryRank,
          trumpRank
        ),

      cards,

      wildAssignments: [],

      label:
        `Pair of ${primaryRank}s`,
    };
  }

  /*
    Joker pair rule:

    SJ + SJ
        =
    BJ + SJ
        <
    BJ + BJ
  */
  if (
    jokers.length === 2
  ) {
    const bigJokerCount =
      jokers.filter(
        isBigJoker
      ).length;

    const smallJokerCount =
      jokers.filter(
        isSmallJoker
      ).length;

    if (
      bigJokerCount === 2
    ) {
      return {
        valid: true,

        type:
          'pair',

        subtype:
          'big-joker-pair',

        cardCount:
          2,

        primaryRank:
          'big-joker',

        strength:
          102,

        cards,

        wildAssignments:
          [],

        label:
          'Pair of Big Jokers',
      };
    }

    if (
      smallJokerCount === 2 ||
      (
        bigJokerCount === 1 &&
        smallJokerCount === 1
      )
    ) {
      return {
        valid: true,

        type:
          'pair',

        subtype:
          'small-joker-level-pair',

        cardCount:
          2,

        primaryRank:
          'small-joker',

        strength:
          101,

        cards,

        wildAssignments:
          [],

        label:
          bigJokerCount === 1
            ? 'Big-Small Joker Pair'
            : 'Pair of Small Jokers',
      };
    }
  }

  return {
    valid: false,
    reason:
      'The selected cards do not form a legal pair.',
  };
}

/* =========================================================
   TRIPLE
   ========================================================= */

function classifyTriple(cards, trumpRank) {
  const jokers =
    cards.filter(
      isJoker
    );

  const normalCards =
    cards.filter(
      (card) =>
        !isJoker(card)
    );

  const normalRanks =
    new Set(
      normalCards.map(
        (card) =>
          card.rank
      )
    );

  if (
    normalRanks.size > 1
  ) {
    return {
      valid: false,

      reason:
        'A triple must represent three cards of the same rank.',
    };
  }

  /*
    Pure Joker triple rule:

    SJ + SJ + SJ
        =
    BJ + SJ + SJ
        =
    BJ + BJ + SJ
        <
    BJ + BJ + BJ

    All pure Joker triples are
    above ordinary / trump triples.
  */
  if (
    normalCards.length === 0 &&
    jokers.length === 3
  ) {
    const bigJokerCount =
      jokers.filter(
        isBigJoker
      ).length;

    if (
      bigJokerCount === 3
    ) {
      return {
        valid: true,

        type:
          'triple',

        subtype:
          'big-joker-triple',

        cardCount:
          3,

        primaryRank:
          'big-joker',

        strength:
          102,

        cards,

        wildAssignments:
          [],

        label:
          'Triple Big Jokers',
      };
    }

    return {
      valid: true,

      type:
        'triple',

      subtype:
        'joker-level-triple',

      cardCount:
        3,

      primaryRank:
        'small-joker',

      strength:
        101,

      cards,

      wildAssignments:
        [],

      label:
        'Joker Triple',
    };
  }

  const primaryRank =
    normalCards[0].rank;

  return {
    valid: true,

    type:
      'triple',

    cardCount:
      3,

    primaryRank,

    strength:
      getRankStrength(
        primaryRank,
        trumpRank
      ),

    cards,

    wildAssignments:
      jokers.map(
        (joker) => ({
          cardId:
            joker.id,

          substitutedRank:
            primaryRank,
        })
      ),

    label:
      `Triple ${primaryRank}s`,
  };
}

/* =========================================================
   STRAIGHT SEARCH
   ========================================================= */

function findBestStraight(
  cards,
  requireSameSuit = false
) {
  const jokers =
    cards.filter(
      isJoker
    );

  const normalCards =
    cards.filter(
      (card) =>
        !isJoker(card)
    );

  const normalRanks =
    normalCards.map(
      (card) =>
        card.rank
    );

  const uniqueNormalRanks =
    new Set(
      normalRanks
    );

  /*
    A straight cannot contain
    duplicate printed ranks.
  */
  if (
    uniqueNormalRanks.size !==
    normalRanks.length
  ) {
    return null;
  }

  /*
    Straight Flush:
    all non-Joker cards must
    share a suit.
  */
  if (
    requireSameSuit &&
    normalCards.length > 0
  ) {
    const suits =
      new Set(
        normalCards.map(
          (card) =>
            card.suit
        )
      );

    if (
      suits.size > 1
    ) {
      return null;
    }
  }

  const candidates =
    [];

  STRAIGHT_SEQUENCES.forEach(
    (sequence) => {
      const sequenceSet =
        new Set(
          sequence
        );

      const allNormalRanksFit =
        normalRanks.every(
          (rank) =>
            sequenceSet.has(
              rank
            )
        );

      if (
        !allNormalRanksFit
      ) {
        return;
      }

      const missingRanks =
        sequence.filter(
          (rank) =>
            !uniqueNormalRanks.has(
              rank
            )
        );

      if (
        missingRanks.length !==
        jokers.length
      ) {
        return;
      }

      candidates.push({
        sequence,

        missingRanks,

        strength:
          getStraightStrength(
            sequence
          ),
      });
    }
  );

  if (
    candidates.length === 0
  ) {
    return null;
  }

  /*
    Wild cards form the strongest
    possible legal straight.
  */
  candidates.sort(
    (a, b) =>
      b.strength -
      a.strength
  );

  return candidates[0];
}

/* =========================================================
   FIVE OF A KIND
   ========================================================= */

function classifyFiveOfAKind(
  cards,
  trumpRank
) {
  const jokers =
    cards.filter(
      isJoker
    );

  const normalCards =
    cards.filter(
      (card) =>
        !isJoker(card)
    );

  const normalRanks =
    new Set(
      normalCards.map(
        (card) =>
          card.rank
      )
    );

  /*
    FIVE JOKERS

    Any five Jokers together are
    the absolute strongest possible
    five-card play.

    Examples:

    SJ,SJ,SJ,SJ,SJ
    BJ,SJ,SJ,SJ,SJ
    BJ,BJ,SJ,SJ,SJ
    BJ,BJ,BJ,SJ,SJ
    BJ,BJ,BJ,BJ,SJ
    BJ,BJ,BJ,BJ,BJ

    ALL of them are exactly equal.

    One five-Joker combination cannot
    defeat another five-Joker combination,
    because equal strength does not beat
    the current lead.
  */
  if (
    normalCards.length === 0 &&
    jokers.length === 5
  ) {
    return {
      valid:
        true,

      type:
        'five-of-a-kind',

      subtype:
        'five-jokers',

      cardCount:
        5,

      categoryStrength:
        FIVE_CARD_CATEGORY_STRENGTH[
          'five-of-a-kind'
        ],

      primaryRank:
        'joker',

      /*
        Higher than every ordinary
        five-of-a-kind.

        Every possible five-Joker mix
        receives this SAME value.
      */
      strength:
        1000,

      cards,

      wildAssignments:
        [],

      label:
        'Five Jokers',
    };
  }

  if (
    normalRanks.size !== 1
  ) {
    return null;
  }

  const primaryRank =
    normalCards[0].rank;

  return {
    valid:
      true,

    type:
      'five-of-a-kind',

    cardCount:
      5,

    categoryStrength:
      FIVE_CARD_CATEGORY_STRENGTH[
        'five-of-a-kind'
      ],

    primaryRank,

    strength:
      getRankStrength(
        primaryRank,
        trumpRank
      ),

    cards,

    wildAssignments:
      jokers.map(
        (joker) => ({
          cardId:
            joker.id,

          substitutedRank:
            primaryRank,
        })
      ),

    label:
      `Five ${primaryRank}s`,
  };
}

/* =========================================================
   STRAIGHT FLUSH
   ========================================================= */

function classifyStraightFlush(
  cards
) {
  const result =
    findBestStraight(
      cards,
      true
    );

  if (
    !result
  ) {
    return null;
  }

  const normalCards =
    cards.filter(
      (card) =>
        !isJoker(card)
    );

  const suit =
    normalCards[0]
      ?.suit ??
    null;

  if (
    !suit
  ) {
    return null;
  }

  return {
    valid:
      true,

    type:
      'straight-flush',

    cardCount:
      5,

    categoryStrength:
      FIVE_CARD_CATEGORY_STRENGTH[
        'straight-flush'
      ],

    primaryRank:
      result.sequence[4],

    strength:
      result.strength,

    cards,

    wildAssignments:
      cards
        .filter(
          isJoker
        )
        .map(
          (
            joker,
            index
          ) => ({
            cardId:
              joker.id,

            substitutedRank:
              result
                .missingRanks[
                  index
                ],

            substitutedSuit:
              suit,
          })
        ),

    label:
      `Straight Flush, ${result.sequence.join('-')}`,
  };
}

/* =========================================================
   FOUR + ONE
   ========================================================= */

function classifyFourPlusOne(
  cards,
  trumpRank
) {
  const jokers =
    cards.filter(
      isJoker
    );

  const rankCounts =
    countRanks(
      cards
    );

  const candidates =
    [];

  for (
    const [
      rank,
      count,
    ] of
    rankCounts.entries()
  ) {
    const jokersNeeded =
      Math.max(
        0,
        4 - count
      );

    if (
      jokersNeeded >
      jokers.length
    ) {
      continue;
    }

    if (
      count +
        jokersNeeded !==
      4
    ) {
      continue;
    }

    candidates.push({
      rank,

      jokersNeeded,

      strength:
        getRankStrength(
          rank,
          trumpRank
        ),
    });
  }

  if (
    candidates.length === 0
  ) {
    return null;
  }

  candidates.sort(
    (a, b) =>
      b.strength -
      a.strength
  );

  const best =
    candidates[0];

  const usedJokers =
    jokers.slice(
      0,
      best.jokersNeeded
    );

  return {
    valid:
      true,

    type:
      'four-plus-one',

    cardCount:
      5,

    categoryStrength:
      FIVE_CARD_CATEGORY_STRENGTH[
        'four-plus-one'
      ],

    primaryRank:
      best.rank,

    strength:
      best.strength,

    cards,

    wildAssignments:
      usedJokers.map(
        (joker) => ({
          cardId:
            joker.id,

          substitutedRank:
            best.rank,
        })
      ),

    label:
      `Four ${best.rank}s + 1`,
  };
}

/* =========================================================
   FULL HOUSE
   ========================================================= */

function classifyFullHouse(
  cards,
  trumpRank
) {
  const jokers =
    cards.filter(
      isJoker
    );

  const normalCards =
    cards.filter(
      (card) =>
        !isJoker(card)
    );

  const rankCounts =
    countRanks(
      cards
    );

  const candidateTripleRanks =
    [
      ...rankCounts.keys(),
    ];

  const candidates =
    [];

  for (
    const tripleRank of
    candidateTripleRanks
  ) {
    const tripleNaturalCount =
      rankCounts.get(
        tripleRank
      ) ??
      0;

    if (
      tripleNaturalCount > 3
    ) {
      continue;
    }

    const jokersForTriple =
      Math.max(
        0,
        3 -
          tripleNaturalCount
      );

    if (
      jokersForTriple >
      jokers.length
    ) {
      continue;
    }

    const remainingJokers =
      jokers.length -
      jokersForTriple;

    const remainingNormalCards =
      [];

    let tripleCardsToRemove =
      3 -
      jokersForTriple;

    normalCards.forEach(
      (card) => {
        if (
          card.rank ===
            tripleRank &&
          tripleCardsToRemove >
            0
        ) {
          tripleCardsToRemove -=
            1;
        } else {
          remainingNormalCards.push(
            card
          );
        }
      }
    );

    if (
      remainingNormalCards.length +
        remainingJokers !==
      2
    ) {
      continue;
    }

    let pairPossible =
      false;

    let pairRank =
      null;

    /*
      Natural pair.
    */
    if (
      remainingNormalCards.length ===
      2
    ) {
      if (
        remainingNormalCards[0]
          .rank ===
          remainingNormalCards[1]
            .rank &&
        remainingNormalCards[0]
          .rank !==
          tripleRank
      ) {
        pairPossible =
          true;

        pairRank =
          remainingNormalCards[0]
            .rank;
      }
    } else if (
      remainingNormalCards.length ===
        1 &&
      remainingJokers ===
        1
    ) {
      /*
        One natural card + Joker.
      */
      if (
        remainingNormalCards[0]
          .rank !==
        tripleRank
      ) {
        pairPossible =
          true;

        pairRank =
          remainingNormalCards[0]
            .rank;
      }
    } else if (
      remainingNormalCards.length ===
        0 &&
      remainingJokers ===
        2
    ) {
      /*
        Two remaining Jokers
        complete the pair.
      */
      pairPossible =
        true;

      pairRank =
        'wild-pair';
    }

    if (
      !pairPossible
    ) {
      continue;
    }

    candidates.push({
      tripleRank,

      pairRank,

      jokersForTriple,

      strength:
        getRankStrength(
          tripleRank,
          trumpRank
        ),
    });
  }

  if (
    candidates.length === 0
  ) {
    return null;
  }

  candidates.sort(
    (a, b) =>
      b.strength -
      a.strength
  );

  const best =
    candidates[0];

  return {
    valid:
      true,

    type:
      'full-house',

    cardCount:
      5,

    categoryStrength:
      FIVE_CARD_CATEGORY_STRENGTH[
        'full-house'
      ],

    primaryRank:
      best.tripleRank,

    strength:
      best.strength,

    cards,

    label:
      best.pairRank ===
      'wild-pair'
        ? `Full House, triple ${best.tripleRank}s`
        : `Full House, ${best.tripleRank}s over ${best.pairRank}s`,
  };
}

/* =========================================================
   FLUSH
   ========================================================= */

function classifyFlush(
  cards
) {
  const jokers =
    cards.filter(
      isJoker
    );

  const normalCards =
    cards.filter(
      (card) =>
        !isJoker(card)
    );

  if (
    normalCards.length === 0
  ) {
    return null;
  }

  const suits =
    new Set(
      normalCards.map(
        (card) =>
          card.suit
      )
    );

  if (
    suits.size !== 1
  ) {
    return null;
  }

  const suit =
    normalCards[0].suit;

  let primaryRank;

  if (
    jokers.length > 0
  ) {
    primaryRank =
      'A';
  } else {
    primaryRank =
      [
        ...normalCards,
      ].sort(
        (a, b) =>
          getOrdinaryRankStrength(
            b.rank
          ) -
          getOrdinaryRankStrength(
            a.rank
          )
      )[0].rank;
  }

  return {
    valid:
      true,

    type:
      'flush',

    cardCount:
      5,

    categoryStrength:
      FIVE_CARD_CATEGORY_STRENGTH.flush,

    primaryRank,

    strength:
      getOrdinaryRankStrength(
        primaryRank
      ),

    cards,

    wildAssignments:
      jokers.map(
        (joker) => ({
          cardId:
            joker.id,

          substitutedRank:
            'A',

          substitutedSuit:
            suit,
        })
      ),

    label:
      `Flush, ${primaryRank} high`,
  };
}

/* =========================================================
   STRAIGHT
   ========================================================= */

function classifyStraight(
  cards
) {
  const result =
    findBestStraight(
      cards,
      false
    );

  if (
    !result
  ) {
    return null;
  }

  return {
    valid:
      true,

    type:
      'straight',

    cardCount:
      5,

    categoryStrength:
      FIVE_CARD_CATEGORY_STRENGTH.straight,

    primaryRank:
      result.sequence[4],

    strength:
      result.strength,

    cards,

    wildAssignments:
      cards
        .filter(
          isJoker
        )
        .map(
          (
            joker,
            index
          ) => ({
            cardId:
              joker.id,

            substitutedRank:
              result
                .missingRanks[
                  index
                ],
          })
        ),

    label:
      `Straight, ${result.sequence.join('-')}`,
  };
}

/* =========================================================
   FIVE-CARD MASTER CLASSIFIER
   ========================================================= */

function classifyFiveCardPlay(
  cards,
  trumpRank
) {
  /*
    Strongest category first.

    This also guarantees that
    five Jokers are recognized as
    the maximum Five of a Kind
    before they can be interpreted
    as another wild-card combination.
  */
  const classifiers = [
    () =>
      classifyFiveOfAKind(
        cards,
        trumpRank
      ),

    () =>
      classifyStraightFlush(
        cards
      ),

    () =>
      classifyFourPlusOne(
        cards,
        trumpRank
      ),

    () =>
      classifyFullHouse(
        cards,
        trumpRank
      ),

    () =>
      classifyFlush(
        cards
      ),

    () =>
      classifyStraight(
        cards
      ),
  ];

  for (
    const runClassifier of
    classifiers
  ) {
    const result =
      runClassifier();

    if (
      result
    ) {
      return result;
    }
  }

  return {
    valid:
      false,

    reason:
      'The selected five cards do not form a legal five-card combination.',
  };
}

/* =========================================================
   MASTER PLAY CLASSIFIER
   ========================================================= */

export function classifyPlay(
  cards,
  trumpRank
) {
  if (
    !Array.isArray(
      cards
    ) ||
    cards.length === 0
  ) {
    return {
      valid:
        false,

      reason:
        'Select at least one card.',
    };
  }

  if (
    cards.length === 1
  ) {
    return classifySingle(
      cards,
      trumpRank
    );
  }

  if (
    cards.length === 2
  ) {
    return classifyPair(
      cards,
      trumpRank
    );
  }

  if (
    cards.length === 3
  ) {
    return classifyTriple(
      cards,
      trumpRank
    );
  }

  if (
    cards.length === 5
  ) {
    return classifyFiveCardPlay(
      cards,
      trumpRank
    );
  }

  return {
    valid:
      false,

    reason:
      'A legal play must contain 1, 2, 3, or 5 cards.',
  };
}

/* =========================================================
   PLAY COMPARISON
   ========================================================= */

export function comparePlays(
  challenger,
  currentLead
) {
  if (
    !challenger?.valid
  ) {
    return {
      valid:
        false,

      reason:
        challenger
          ?.reason ??
        'Invalid play.',
    };
  }

  /*
    Leading player can play
    any legal combination.
  */
  if (
    !currentLead
  ) {
    return {
      valid:
        true,

      result:
        1,
    };
  }

  /*
    Same card count required.
  */
  if (
    challenger.cardCount !==
    currentLead.cardCount
  ) {
    return {
      valid:
        false,

      reason:
        `You must play exactly ${currentLead.cardCount} card(s).`,
    };
  }

  /*
    FIVE-CARD COMPARISON

    Category first.
    Strength second.

    Equal strength does NOT beat
    the current lead.

    Therefore:
    any five Jokers cannot beat
    another five Jokers.
  */
  if (
    challenger.cardCount === 5
  ) {
    if (
      challenger
        .categoryStrength >
      currentLead
        .categoryStrength
    ) {
      return {
        valid:
          true,

        result:
          1,
      };
    }

    if (
      challenger
        .categoryStrength <
      currentLead
        .categoryStrength
    ) {
      return {
        valid:
          false,

        reason:
          `${challenger.label} does not defeat ${currentLead.label}.`,
      };
    }

    if (
      challenger.strength <=
      currentLead.strength
    ) {
      return {
        valid:
          false,

        reason:
          `${challenger.label} does not defeat ${currentLead.label}.`,
      };
    }

    return {
      valid:
        true,

      result:
        1,
    };
  }

  /*
    Single / Pair / Triple:
    same type required.
  */
  if (
    challenger.type !==
    currentLead.type
  ) {
    return {
      valid:
        false,

      reason:
        `A ${challenger.type} cannot defeat a ${currentLead.type}.`,
    };
  }

  /*
    Equal strength does not beat.

    This is important for:

    SJ+SJ = BJ+SJ

    and

    SSS = BSS = BBS
  */
  if (
    challenger.strength <=
    currentLead.strength
  ) {
    return {
      valid:
        false,

      reason:
        `${challenger.label} does not defeat ${currentLead.label}.`,
    };
  }

  return {
    valid:
      true,

    result:
      1,
  };
}

/* =========================================================
   PUBLIC VALIDATION FUNCTION
   ========================================================= */

export function validatePlay(
  cards,
  trumpRank,
  currentLead
) {
  const combination =
    classifyPlay(
      cards,
      trumpRank
    );

  if (
    !combination.valid
  ) {
    return {
      valid:
        false,

      reason:
        combination.reason,
    };
  }

  const comparison =
    comparePlays(
      combination,
      currentLead
    );

  if (
    !comparison.valid
  ) {
    return {
      valid:
        false,

      reason:
        comparison.reason,

      combination,
    };
  }

  return {
    valid:
      true,

    combination,
  };
}