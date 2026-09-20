// Family Circle — card engine
// Implements exactly what is written in the agreed rule sheet and the
// card/power reference sheet. Anywhere the sheets left a mechanic
// unspecified, this file makes the smallest, most consistent choice and
// flags it with an ASSUMPTION comment — see README "Open rule questions"
// for the full list so the family can confirm or override them.

export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs']
export const RED_SUITS = ['hearts', 'diamonds']
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export const SUIT_SYMBOL = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' }
export const SUIT_LABEL = { spades: 'Spades', hearts: 'Hearts', diamonds: 'Diamonds', clubs: 'Clubs' }

export function rankIndex(rank) {
  return RANKS.indexOf(rank)
}

export function isRed(card) {
  return RED_SUITS.includes(card.suit)
}

export function isBlackJack(card) {
  return card.rank === 'J' && !isRed(card)
}

export function isRedJack(card) {
  return card.rank === 'J' && isRed(card)
}

// Power classification, straight from the Card & Power Reference sheet.
export function cardPower(card, activePlayerCount = 3) {
  if (card.rank === 'A') return 'ace'
  if (card.rank === '2') return 'two'
  if (card.rank === '7' && activePlayerCount !== 2) return 'seven'
  if (card.rank === '8') return 'eight'
  if (isRedJack(card)) return 'redjack'
  if (isBlackJack(card)) return 'blackjack'
  return null // 3,4,5,6,9,10,Q,K are NORMAL
}

export function isPowerCard(card, activePlayerCount = 3) {
  return cardPower(card, activePlayerCount) !== null
}

export function makeDeck() {
  const deck = []
  let n = 0
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `${rank}-${suit}-${n++}`, rank, suit })
    }
  }
  return deck
}

export function shuffle(array) {
  const a = array.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function cardLabel(card) {
  return `${card.rank} of ${SUIT_LABEL[card.suit]}`
}

export function cardShort(card) {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`
}

// The connection rule used everywhere cards must "connect": rule sheet
// section 4 (Card Runs) — same suit sequential rank, OR same rank
// different suit. Ace/King do not wrap.
export function canConnect(a, b) {
  if (!a || !b) return false
  if (a.suit === b.suit && Math.abs(rankIndex(a.rank) - rankIndex(b.rank)) === 1) return true
  if (a.rank === b.rank && a.suit !== b.suit) return true
  return false
}

// A normal play matches the exposed top card by either rank OR suit.
// Ace is the one wild card and may be played at any time.
// When an Ace has chosen a suit, that suit becomes the required suit until
// another Ace changes it. Pickup responses are handled separately because
// 2 / Black Jack / Red Jack have their own counter rules.
export function canLeadWith(card, topCard, requiredSuit) {
  if (card.rank === 'A') return true
  if (requiredSuit) return card.suit === requiredSuit
  if (!topCard) return false
  return card.rank === topCard.rank || card.suit === topCard.suit
}

// Returns the cards the UI should initially mark as playable suggestions.
// This is deliberately an assistance layer: it never chooses or plays cards.
// Runs can be explored from these starting cards by the UI without duplicating
// the core legality rules.
export function suggestedCardIds(hand, topCard, requiredSuit, pendingPickup = 0, pendingSkip = 0) {
  if (pendingPickup > 0) {
    return hand
      .filter((card) => canCounterPickup(card) || isRedJack(card))
      .map((card) => card.id)
  }

  if (pendingSkip > 0) {
    return hand.filter((card) => card.rank === '8').map((card) => card.id)
  }

  return hand
    .filter((card) => canLeadWith(card, topCard, requiredSuit))
    .map((card) => card.id)
}

// Validates an ordered list of cards as one legal run: every adjacent
// pair must connect. (Direction, and reversal mid-run, fall out of this
// automatically — we never demand a single ascending/descending order,
// only that each step is valid.)
export function validateRunChain(cards) {
  if (cards.length === 0) return false
  for (let i = 1; i < cards.length; i++) {
    if (!canConnect(cards[i - 1], cards[i])) return false
  }
  return true
}

// Finishing rule: in a 1v1 game, the 7 is a normal finishable card and
// is NOT a reverse card. With 3–7 active players, a 7 is the reverse
// power card and cannot be the finishing card. All other power cards
// cannot finish the hand.
export function canFinishOn(card, activePlayerCount = 3) {
  // In 1v1, 7 is normal and therefore finishable.
  // With 3–7 active players, 7 is reverse and cannot finish.
  const power = cardPower(card, activePlayerCount)
  return power === null
}

// ASSUMPTION (documented in README): the sheets describe stacking for
// 8s explicitly ("multiple 8s can be played together to extend the
// number skipped") and describe pickup stacking generally for 2s and
// Black Jacks ("pickup penalties stack" / "can stack with 2s"). Runs of
// same-rank cards already validate under the connection rule (same
// rank, different suit), so this engine applies one consistent rule:
// only the exposed/final card of a run activates its power (per rule
// sheet 5), but if the run ends in an unbroken group of cards sharing
// that final card's rank, every card in that trailing group counts
// toward the stack. A single card is a "group" of one.
function trailingSameRankCount(cards) {
  if (cards.length === 0) return 0
  const rank = cards[cards.length - 1].rank
  let count = 0
  for (let i = cards.length - 1; i >= 0; i--) {
    if (cards[i].rank === rank) count++
    else break
  }
  return count
}

// Applies the effect of a completed, already-validated play to a plain
// state-ish object of { pendingPickup, direction, pendingSkip, requiredSuit }.
// Returns a new object with the effect applied, plus a `chosenSuit`
// placeholder flag if the caller must still prompt for a suit (Ace).
export function computePlayEffect(playedCards, activePlayerCount = 3) {
  const finalCard = playedCards[playedCards.length - 1]
  const power = cardPower(finalCard, activePlayerCount)
  const stack = trailingSameRankCount(playedCards)

  const effect = {
    power,
    finalCard,
    pickupAdd: 0,
    skipAdd: 0,
    reverseCount: 0,
    cancelPickup: false,
    needsSuitChoice: false,
  }

  if (power === 'ace') {
    effect.needsSuitChoice = true
  } else if (power === 'two') {
    effect.pickupAdd = 2 * stack
  } else if (power === 'blackjack') {
    effect.pickupAdd = 5 * stack
  } else if (power === 'eight') {
    effect.skipAdd = stack
  } else if (power === 'redjack') {
    effect.cancelPickup = true
  } else if (power === 'seven') {
    effect.reverseCount = stack
  }

  return effect
}

// Can this specific card be used to answer/counter a pending pickup?
export function canCounterPickup(card) {
  return card.rank === '2' || isBlackJack(card)
}

// Pickup stacking is additive: every 2 contributes +2 and every Black Jack
// contributes +5. This helper is shared so the calculation cannot diverge
// between an initial pickup play and a later stacking response.
export function pickupValue(card) {
  if (card?.rank === '2') return 2
  if (isBlackJack(card)) return 5
  return 0
}

export function pickupValueForCards(cards) {
  return cards.reduce((total, card) => total + pickupValue(card), 0)
}

export function dealHands(deck, numPlayers, handSize, dealOrder = null) {
  const hands = Array.from({ length: numPlayers }, () => [])
  const order = Array.isArray(dealOrder) ? dealOrder.slice() : Array.from({ length: numPlayers }, (_, index) => index)
  let d = deck.slice()
  for (let r = 0; r < handSize; r++) {
    for (const playerIndex of order) hands[playerIndex].push(d.shift())
  }
  return { hands, remainingDeck: d }
}