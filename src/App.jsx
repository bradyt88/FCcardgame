import { useEffect, useReducer, useState } from 'react'
import {
  SUIT_SYMBOL,
  RANKS,
  makeDeck,
  shuffle,
  dealHands,
  canLeadWith,
  validateRunChain,
  canFinishOn,
  canCounterPickup,
  isRedJack,
  isBlackJack,
  isPowerCard,
  suggestedCardIds,
  computePlayEffect,
} from './game/engine.js'
import { FAMILY_CIRCLE_LOGO } from './logo.js'
import BackgroundMusic from './BackgroundMusic.jsx'
import {
  DEFAULT_DIRECTION,
  assignDemoSeats,
  nextOccupiedSeat,
  playerAtSeat,
} from './game/table.js'
// ---------- deck / draw pile helpers ----------

function drawCards(deck, discard, count) {
  let d = deck.slice()
  let disc = discard.slice()
  const drawn = []
  for (let i = 0; i < count; i++) {
    if (d.length === 0) {
      if (disc.length <= 1) break
      const top = disc[disc.length - 1]
      const rest = disc.slice(0, -1).reverse() // turned over, NOT shuffled — rule 6
      d = rest
      disc = [top]
    }
    drawn.push(d.shift())
  }
  return { drawn, deck: d, discard: disc }
}

// ---------- initial / reducer ----------

const initialState = { phase: 'home' }

const TURN_SECONDS = 30
const DECLARATION_SECONDS = 3
const CHALLENGE_SECONDS = 3
const DEAL_ANIMATION_MS = 2800
const TURN_TRANSITION_MS = 1800
const PLAY_CARD_STEP_MS = 250

function sortHand(hand) {
  return hand.slice().sort((a, b) => {
    const rankDiff = RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank)
    if (rankDiff !== 0) return rankDiff
    return a.suit.localeCompare(b.suit)
  })
}

function findWholeHandRun(hand, topCard, requiredSuit, activePlayerCount = 3) {
  if (!hand.length) return null
  const connectForRun = (a, b) => (
    a.rank === b.rank
      ? a.suit !== b.suit
      : a.suit === b.suit && Math.abs(RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank)) === 1
  )
  const search = (remaining, path) => {
    if (!remaining.length) return canFinishOn(path[path.length - 1], activePlayerCount) ? path : null
    for (let i = 0; i < remaining.length; i++) {
      const card = remaining[i]
      const legal = path.length === 0 ? canLeadWith(card, topCard, requiredSuit) : connectForRun(path[path.length - 1], card)
      if (!legal) continue
      const next = remaining.slice(0, i).concat(remaining.slice(i + 1))
      const found = search(next, [...path, card])
      if (found) return found
    }
    return null
  }
  return search(hand.slice(), [])
}

function startNewGame(setup, dealerSeatOverride = null) {
  const { players: rawPlayers } = setup
  const handSize = 7
  const playersWithoutHands = assignDemoSeats(rawPlayers)
  const dealerSeat = Number.isInteger(dealerSeatOverride)
    ? dealerSeatOverride
    : playersWithoutHands[Math.floor(Math.random() * playersWithoutHands.length)].seatIndex

  // The dealer is established first, then shuffles the full pack and deals
  // one card at a time starting with themselves and moving left.
  const deck = shuffle(makeDeck())
  const dealOrder = playersWithoutHands
    .map((p, index) => ({ index, seatIndex: p.seatIndex }))
    .sort((x, y) => (
      ((dealerSeat - x.seatIndex + 7) % 7) - ((dealerSeat - y.seatIndex + 7) % 7)
    ))
    .map(({ index }) => index)
  const { hands, remainingDeck } = dealHands(deck, rawPlayers.length, handSize, dealOrder)
  const players = playersWithoutHands.map((p, i) => ({
    ...p,
    hand: sortHand(hands[i]),
    out: false,
  }))
  // The opening play card must be a normal card, not a power card.
  // Keep turning cards until a non-power card is exposed, then retain the
  // displaced cards in the draw pile without shuffling them.
  let deckLeft = remainingDeck.slice()
  let firstCard = deckLeft.shift()
  const bottomBuffer = []
  while (firstCard && isPowerCard(firstCard, players.length) && deckLeft.length > 0) {
    bottomBuffer.push(firstCard)
    firstCard = deckLeft.shift()
  }
  deckLeft = [...deckLeft, ...bottomBuffer]

  return {
    phase: 'dealing',
    mode: setup.mode || 'local-demo',
    gameMode: setup.gameMode || 'winner-takes-all',
    settings: { handSize },
    players,
    dealerSeat,
    currentSeat: dealerSeat,
    localPlayerId: setup.localPlayerId || players[0]?.id || null,
    direction: DEFAULT_DIRECTION,
    deck: deckLeft,
    discard: [firstCard],
    requiredSuit: null,
    pendingPickup: 0,
    pendingSkip: 0,
    selectedCardIds: [],
    hasDrawnThisTurn: false,
    feedback: null,
    log: [`New round dealt. ${playerAtSeat(players, dealerSeat).name} is the random dealer and starts. ${firstCard.rank} of ${firstCard.suit} starts the pile.`],
    winner: null,
    turnDeadline: null,
    lastCardDeadline: null,
    lastCardChallengeDeadline: null,
    lastCardPlayerId: null,
    lastCardsAnnounced: false,
    recentPlayCards: [],
    transitionPlayerName: null,
    transitionStartedAt: null,
    aceSuitChange: null,
    pickupAnimation: null,
    dealStartedAt: Date.now(),
  }
}

function pushLog(state, line) {
  const log = [line, ...state.log].slice(0, 6)
  return { ...state, log }
}

function reducer(state, action) {
  switch (action.type) {
    case 'START_GAME':
      return startNewGame(action.payload)

    case 'GO_HOME':
      return { phase: 'home' }

    case 'GO_TO_SETUP':
      return { phase: 'lobby-home' }

    case 'SHOW_LOBBY_CREATE':
      return { phase: 'lobby-create' }

    case 'SHOW_LOBBY_JOIN':
      return { phase: 'lobby-join' }

    case 'LOBBY_BACK':
      return { phase: 'lobby-home' }

    case 'SHOW_RULES':
      return { phase: 'rules' }

    case 'SHOW_POWER_CARDS':
      return { phase: 'power-cards' }

    case 'DEAL_COMPLETE': {
      if (state.phase !== 'dealing') return state
      return {
        ...state,
        phase: state.pendingPickup > 0 ? 'pickup-response' : 'card-play',
        turnDeadline: Date.now() + TURN_SECONDS * 1000,
        dealStartedAt: null,
      }
    }

    case 'READY_FOR_CARDS': {
      const currentPlayer = playerAtSeat(state.players, state.currentSeat)
      const demoView = state.mode === 'local-demo' && currentPlayer
        ? { localPlayerId: currentPlayer.id }
        : {}
      const base = {
        ...state,
        ...demoView,
        feedback: null,
        selectedCardIds: [],
        hasDrawnThisTurn: false,
      }
      const phase = state.pendingPickup > 0
        ? 'pickup-response'
        : state.pendingSkip > 0
          ? 'skip-response'
          : 'card-play'
      return { ...base, phase, turnDeadline: Date.now() + TURN_SECONDS * 1000 }
    }

    case 'TOGGLE_CARD': {
      const id = action.payload
      const sel = state.selectedCardIds
      if (sel.includes(id)) {
        return { ...state, selectedCardIds: sel.filter((cardId) => cardId !== id) }
      }
      return { ...state, selectedCardIds: [...sel, id] }
    }

    case 'CLEAR_SELECTION':
      return { ...state, selectedCardIds: [] }

    case 'END_TURN': {
      if (!state.hasDrawnThisTurn || state.pendingPickup > 0 || state.pendingSkip > 0) return state
      return endTurn(state, { reverseCount: 0 })
    }

    case 'ACCEPT_SKIP': {
      const player = playerAtSeat(state.players, state.currentSeat)
      const nextState = pushLog(
        { ...state, pendingSkip: 0 },
        `${player.name} accepted the skip.`
      )
      return advanceToNextTurn(nextState)
    }

    case 'PLAY_PICKUP_RESPONSE': {
      const player = playerAtSeat(state.players, state.currentSeat)
      const cards = state.selectedCardIds.map((id) => player.hand.find((c) => c.id === id))
      if (cards.length === 0) return state

      const allRedJackSingle = cards.length === 1 && isRedJack(cards[0])
      const allCounters = cards.every((c) => canCounterPickup(c))
      if (!allRedJackSingle && !allCounters) {
        return { ...state, feedback: { error: 'Pick only 2s / Black Jacks to stack, or a single Red Jack to cancel.' } }
      }

      const newHand = player.hand.filter((c) => !state.selectedCardIds.includes(c.id))
      if (newHand.length === 0 && !canFinishOn(cards[cards.length - 1], state.players.filter((p) => !p.out).length)) {
        return { ...state, feedback: { error: "You can't finish your hand on a power card." } }
      }

      const players = state.players.map((p) => (
        p.seatIndex === state.currentSeat ? { ...player, hand: newHand } : p
      ))
      const discard = [...state.discard, ...cards]

      let pendingPickup = state.pendingPickup
      let logLine
      if (allRedJackSingle) {
        pendingPickup = 0
        logLine = `${player.name} played a Red Jack — pickup cancelled.`
      } else {
        const add = cards.reduce((sum, c) => sum + (isBlackJack(c) ? 5 : 2), 0)
        pendingPickup += add
        logLine = `${player.name} stacked the pickup to ${pendingPickup}.`
      }

      if (newHand.length === 0) {
        return pushLog(
          { ...state, players, discard, pendingPickup: 0, phase: 'round-over', winner: player.id, turnDeadline: null },
          `${player.name} goes out!`
        )
      }

      const nextState = pushLog({ ...state, players, discard, pendingPickup, requiredSuit: null, recentPlayCards: cards, pickupAnimation: pendingPickup > 0 ? { amount: pendingPickup, kind: 'pickup' } : null }, logLine)
      if (newHand.length === 1) {
        // If the played card is an Ace, the player must choose the next suit
        // before declaring Last Card. The three-second Last Card window starts
        // only after the suit has been chosen.
        if (effect.needsSuitChoice) {
          return {
            ...nextState,
            phase: 'suit-pick-last-card',
            lastCardPlayerId: player.id,
            lastCardDeadline: null,
            lastCardChallengeDeadline: null,
            pendingEffect: effect,
            turnDeadline: null,
          }
        }
        return {
          ...nextState,
          phase: 'last-card-declare',
          lastCardPlayerId: player.id,
          lastCardDeadline: Date.now() + DECLARATION_SECONDS * 1000,
          lastCardChallengeDeadline: null,
          turnDeadline: null,
        }
      }
      return endTurn(nextState, { reverseCount: 0 })
    }

    case 'DRAW_PICKUP': {
      const player = playerAtSeat(state.players, state.currentSeat)
      const { drawn, deck, discard } = drawCards(state.deck, state.discard, state.pendingPickup)
      const players = state.players.map((p) => (
        p.seatIndex === state.currentSeat ? { ...player, hand: sortHand([...player.hand, ...drawn]) } : p
      ))
      const nextState = pushLog(
        { ...state, players, deck, discard, pendingPickup: 0, pickupAnimation: drawn.length >= 2 ? { amount: drawn.length, kind: 'pickup' } : null },
        `${player.name} picked up ${drawn.length} card(s).`
      )
      return endTurn(nextState, { reverseCount: 0 })
    }

    case 'DRAW_ONE': {
      if (state.hasDrawnThisTurn) return state
      const player = playerAtSeat(state.players, state.currentSeat)
      const { drawn, deck, discard } = drawCards(state.deck, state.discard, 1)
      const players = state.players.map((p) => (
        p.seatIndex === state.currentSeat ? { ...player, hand: sortHand([...player.hand, ...drawn]) } : p
      ))
      return pushLog(
        { ...state, players, deck, discard, hasDrawnThisTurn: true },
        `${player.name} drew a card.`
      )
    }


    case 'PLAY_SELECTED': {
      const player = playerAtSeat(state.players, state.currentSeat)
      const cards = state.selectedCardIds.map((id) => player.hand.find((c) => c.id === id))
      if (cards.length === 0) return state

      const topCard = state.discard[state.discard.length - 1]
      if (state.pendingSkip > 0 && cards.some((card) => card.rank !== '8')) {
        return { ...state, feedback: { error: 'A skip is active. Play an 8 to continue the stack, or accept the skip.' } }
      }
      if (!canLeadWith(cards[0], topCard, state.requiredSuit)) {
        return { ...state, feedback: { error: `That doesn't connect to the ${topCard.rank} of ${topCard.suit}${state.requiredSuit ? ` — ACE changed the suit to ${state.requiredSuit.toUpperCase()}. Play a ${state.requiredSuit.toUpperCase()} or another ACE.` : '.'}` } }
      }
      if (!validateRunChain(cards)) {
        return { ...state, feedback: { error: 'Those cards don\u2019t form a valid connected run.' } }
      }

      const newHand = player.hand.filter((c) => !state.selectedCardIds.includes(c.id))
      const finishing = newHand.length === 0
      if (finishing && !canFinishOn(cards[cards.length - 1], state.players.filter((p) => !p.out).length)) {
        return { ...state, feedback: { error: 'You can\u2019t finish your hand on that power card.' } }
      }

      const players = state.players.map((p) => (
        p.seatIndex === state.currentSeat ? { ...player, hand: newHand } : p
      ))
      const discard = [...state.discard, ...cards]
      const effect = computePlayEffect(cards, state.players.filter((p) => !p.out).length)

      let nextState = pushLog(
        { ...state, players, discard, requiredSuit: effect.power === 'ace' ? state.requiredSuit : null, recentPlayCards: cards },
        `${player.name} played ${cards.map((c) => `${c.rank}${SUIT_SYMBOL[c.suit]}`).join(' \u2192 ')}.`
      )

      if (finishing) {
        return { ...nextState, phase: 'round-over', winner: player.id, turnDeadline: null }
      }

      if (newHand.length === 1) {
        return {
          ...nextState,
          phase: 'last-card-declare',
          lastCardPlayerId: player.id,
          lastCardDeadline: Date.now() + DECLARATION_SECONDS * 1000,
          lastCardChallengeDeadline: null,
          turnDeadline: null,
        }
      }

      if (effect.cancelPickup) nextState = { ...nextState, pendingPickup: 0 }
      else if (effect.pickupAdd) { const pickupAmount = nextState.pendingPickup + effect.pickupAdd; nextState = { ...nextState, pendingPickup: pickupAmount, pickupAnimation: { amount: pickupAmount, kind: 'pickup' } } }

      if (effect.needsSuitChoice) {
        return { ...nextState, phase: 'suit-pick', pendingEffect: effect }
      }

      return endTurn(nextState, effect)
    }

    case 'CHOOSE_SUIT': {
      const chosenSuit = action.payload
      const player = playerAtSeat(state.players, state.currentSeat)

      if (state.phase === 'suit-pick-last-card') {
        return {
          ...state,
          requiredSuit: chosenSuit,
          pendingEffect: undefined,
          aceSuitChange: {
            playerName: player?.name || 'Player',
            suit: chosenSuit,
            startedAt: Date.now(),
          },
          phase: 'last-card-declare',
          lastCardDeadline: Date.now() + DECLARATION_SECONDS * 1000,
          lastCardChallengeDeadline: null,
          lastCardPlayerId: player?.id || state.lastCardPlayerId,
          turnDeadline: null,
          feedback: { success: 'SUIT CHANGED — DECLARE LAST CARD' },
        }
      }

      const withSuit = {
        ...state,
        requiredSuit: chosenSuit,
        pendingEffect: undefined,
        aceSuitChange: {
          playerName: player?.name || 'Player',
          suit: chosenSuit,
          startedAt: Date.now(),
        },
      }
      return endTurn(withSuit, state.pendingEffect || {})
    }

    case 'DECLARE_LAST_CARD': {
      if (state.phase !== 'last-card-declare') return state
      const player = playerAtSeat(state.players, state.currentSeat)
      if (!player || player.id !== state.lastCardPlayerId) return state

      // A successful declaration ends the declaration window immediately.
      // The challenge window is only created by LAST_CARD_TIMEOUT, i.e. when
      // the player failed to declare Last Card in time.
      const nextState = endTurn(
        {
          ...state,
          lastCardDeadline: null,
          lastCardChallengeDeadline: null,
          feedback: { success: 'LAST CARD!' },
        },
        { reverseCount: 0 }
      )
      return nextState
    }

    case 'LAST_CARD_TIMEOUT': {
      if (state.phase !== 'last-card-declare') return state
      return {
        ...state,
        phase: 'last-card-challenge',
        lastCardDeadline: null,
        lastCardChallengeDeadline: Date.now() + CHALLENGE_SECONDS * 1000,
        feedback: { success: 'LAST CARD WAS NOT DECLARED' },
      }
    }

    case 'CHALLENGE_LAST_CARD': {
      if (state.phase !== 'last-card-challenge') return state
      const player = playerAtSeat(state.players, state.currentSeat)
      if (!player || player.id !== state.lastCardPlayerId) return state
      const { drawn, deck, discard } = drawCards(state.deck, state.discard, 1)
      const players = state.players.map((p) => (
        p.id === player.id ? { ...player, hand: sortHand([...player.hand, ...drawn]) } : p
      ))
      const nextState = pushLog(
        {
          ...state,
          players,
          deck,
          discard,
          lastCardChallengeDeadline: null,
          lastCardPlayerId: null,
          feedback: { success: 'LAST CARD CHALLENGE — PICK UP 1' },
        },
        player.name + ' was challenged and picked up 1 card.'
      )
      return endTurn(nextState, { reverseCount: 0 })
    }

    case 'LAST_CARD_CHALLENGE_EXPIRED': {
      if (state.phase !== 'last-card-challenge') return state
      return endTurn(
        {
          ...state,
          lastCardChallengeDeadline: null,
          lastCardPlayerId: null,
        },
        { reverseCount: 0 }
      )
    }

    case 'DECLARE_LAST_CARDS': {
      const player = playerAtSeat(state.players, state.currentSeat)
      if (!player) return state
      const run = findWholeHandRun(player.hand, state.discard?.[state.discard.length - 1], state.requiredSuit)
      if (!run) return { ...state, feedback: { error: 'Your whole hand does not form a legal finishing run.' } }
      return {
        ...state,
        selectedCardIds: run.map((card) => card.id),
        lastCardsAnnounced: true,
        feedback: { success: 'LAST CARDS!' },
      }
    }

    case 'TURN_TRANSITION_COMPLETE': {
      if (!state.transitionStartedAt) return state
      const transitionDuration = Math.min(2000, Math.max(TURN_TRANSITION_MS, (state.recentPlayCards?.length || 0) * PLAY_CARD_STEP_MS + 700))
      if (Date.now() - state.transitionStartedAt < transitionDuration) return state
      return {
        ...state,
        recentPlayCards: [],
        transitionPlayerName: null,
        transitionStartedAt: null,
        aceSuitChange: null,
        pickupAnimation: null,
        turnDeadline: Date.now() + TURN_SECONDS * 1000,
      }
    }

    case 'TURN_TIMEOUT': {
      if (state.phase !== 'card-play' || !state.turnDeadline || Date.now() < state.turnDeadline) return state
      const player = playerAtSeat(state.players, state.currentSeat)
      if (!player) return state
      const { drawn, deck, discard } = drawCards(state.deck, state.discard, 1)
      const players = state.players.map((p) => (
        p.id === player.id ? { ...player, hand: sortHand([...player.hand, ...drawn]) } : p
      ))
      const nextState = pushLog(
        { ...state, players, deck, discard, hasDrawnThisTurn: true },
        player.name + ' timed out and picked up 1 card.'
      )
      return endTurn(nextState, { reverseCount: 0 })
    }

    case 'PLAY_AGAIN': {
      const setup = {
        players: state.players.map((p) => ({
          id: p.id,
          name: p.name,
          seatIndex: p.seatIndex,
        })),
        handSize: state.settings.handSize,
        mode: state.mode,
        gameMode: state.gameMode,
        localPlayerId: state.localPlayerId,
      }
      const nextDealer = nextOccupiedSeat(state.players, state.dealerSeat, DEFAULT_DIRECTION)
      return startNewGame(setup, nextDealer)
    }

    default:
      return state
  }
}

function advanceToNextTurn(state, effect = {}) {
  let direction = state.direction
  if (effect.reverseCount && effect.reverseCount % 2 === 1) direction = direction * -1

  const pendingSkip = (state.pendingSkip || 0) + (effect.skipAdd || 0)
  const nextSeat = nextOccupiedSeat(state.players, state.currentSeat, direction)

  const finishingPlayer = playerAtSeat(state.players, state.currentSeat)
  const shouldTransition = Boolean(finishingPlayer)
  return {
    ...state,
    direction,
    currentSeat: nextSeat,
    pendingSkip,
    phase: pendingSkip > 0 ? 'skip-response' : 'card-play',
    selectedCardIds: [],
    hasDrawnThisTurn: false,
    feedback: null,
    turnDeadline: shouldTransition ? null : Date.now() + TURN_SECONDS * 1000,
    lastCardDeadline: null,
    lastCardChallengeDeadline: null,
    lastCardPlayerId: null,
    lastCardsAnnounced: false,
    transitionPlayerName: shouldTransition ? finishingPlayer.name : null,
    transitionStartedAt: shouldTransition ? Date.now() : null,
  }
}

function endTurn(state, effect = {}) {
  return advanceToNextTurn({ ...state, pendingSkip: state.pendingSkip || 0 }, effect)
}

// ---------- UI ----------

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)

  if (state.phase === 'home') {
    return (
      <HomeScreen
        onPlay={() => dispatch({ type: 'GO_TO_SETUP' })}
        onRules={() => dispatch({ type: 'SHOW_RULES' })}
        onPowerCards={() => dispatch({ type: 'SHOW_POWER_CARDS' })}
      />
    )
  }

  if (state.phase === 'lobby-home') {
    return <LobbyHomeScreen
      onBack={() => dispatch({ type: 'GO_HOME' })}
      onCreate={() => dispatch({ type: 'SHOW_LOBBY_CREATE' })}
      onJoin={() => dispatch({ type: 'SHOW_LOBBY_JOIN' })}
    />
  }

  if (state.phase === 'lobby-create') {
    return <LobbyCreateScreen
      onBack={() => dispatch({ type: 'LOBBY_BACK' })}
      onHome={() => dispatch({ type: 'GO_HOME' })}
      onStart={(payload) => dispatch({ type: 'START_GAME', payload })}
    />
  }

  if (state.phase === 'lobby-join') {
    return <LobbyJoinScreen
      onBack={() => dispatch({ type: 'LOBBY_BACK' })}
      onHome={() => dispatch({ type: 'GO_HOME' })}
    />
  }

  if (state.phase === 'setup') {
    return <SetupScreen onBack={() => dispatch({ type: 'GO_HOME' })} onStart={(payload) => dispatch({ type: 'START_GAME', payload })} />
  }

  if (state.phase === 'rules') {
    return <RulesScreen onBack={() => dispatch({ type: 'GO_HOME' })} />
  }

  if (state.phase === 'power-cards') {
    return <PowerCardsScreen onBack={() => dispatch({ type: 'GO_HOME' })} />
  }

  return <GameBody state={state} dispatch={dispatch} />
}

function HomeScreen({ onPlay, onRules, onPowerCards }) {
  const logoSrc = FAMILY_CIRCLE_LOGO
  return (
    <main className="home-screen">
      <div className="home-orbit orbit-one" aria-hidden="true" />
      <div className="home-orbit orbit-two" aria-hidden="true" />
      <div className="home-glow glow-pink" aria-hidden="true" />
      <div className="home-glow glow-blue" aria-hidden="true" />

      <section className="home-card" aria-label="Family Circle card game">
        <svg className="home-logo-filters" width="0" height="0" aria-hidden="true">
          <defs>
            <filter id="home-logo-sharpen" x="-10%" y="-10%" width="120%" height="120%">
              <feConvolveMatrix order="3" preserveAlpha="true" kernelMatrix="0 -1 0 -1 5 -1 0 -1 0" />
            </filter>
          </defs>
        </svg>

        <div className="home-hero">
          <img
            className="home-logo"
            src={logoSrc}
            alt="Family Circle — Together Always"
          />
          <div className="home-title">THE CARD GAME</div>
          <p className="home-copy">A private family card game for 2–7 players.</p>
        </div>

        <div className="home-actions">
          <button className="btn primary big home-play" onClick={onPlay}>
            <span className="home-button-icon" aria-hidden="true">▶</span>
            <span>PLAY A GAME</span>
          </button>

          <div className="home-secondary">
            <button className="btn secondary home-secondary-button" onClick={onRules}>
              <span className="home-button-icon" aria-hidden="true">▣</span>
              <span>RULES</span>
            </button>
            <button className="btn secondary home-secondary-button" onClick={onPowerCards}>
              <span className="home-button-icon" aria-hidden="true">▱</span>
              <span>POWER CARDS</span>
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}

function RulesScreen({ onBack }) {
  return (
    <div className="info-screen">
      <div className="info-card">
        <img className="info-logo" src={FAMILY_CIRCLE_LOGO} alt="Family Circle" />
        <h1>Family Circle Rules</h1>
        <p className="info-intro">Card-game rules reference.</p>
        <div className="info-grid">
          <div><strong>Players</strong><span>2–7 players</span></div>
          <div><strong>Cards</strong><span>Standard 52-card deck</span></div>
          <div><strong>Objective</strong><span>Be the first player to get rid of every card in your hand.</span></div>
          <div><strong>Starting hand</strong><span>7 cards; cards are removed as you play them.</span></div>
          <div><strong>Turn</strong><span>Dealer starts; play then moves left. Each turn has 30 seconds.</span></div>
          <div><strong>Last Card</strong><span>At 1 card, declare within 3 seconds. If missed, a 3-second challenge window opens; a successful challenge adds 1 card.</span></div>
          <div><strong>Runs</strong><span>Cards connect by same suit + adjacent rank, or same rank in different suits.</span></div>
          <div><strong>Draw pile</strong><span>If exhausted, the discard pile is turned over without shuffling, keeping the top card active.</span></div>
        </div>
        <button className="btn secondary back-btn" onClick={onBack}>BACK</button>
      </div>
    </div>
  )
}

function PowerCardsScreen({ onBack }) {
  const cards = [
    ['Ace', 'Wild — playable any time and chooses the next suit.'],
    ['2', '+2 pickup and stacks with other 2s and Black Jacks.'],
    ['7', 'Reverses direction with 3+ players. In 1v1, the 7 has no power and may be the finishing card.'],
    ['8', 'Skips the next player and can be stacked/cancelled by another 8.'],
    ['Red Jack', 'Cancels an active pickup.'],
    ['Black Jack', '+5 pickup and stacks with 2s and other Black Jacks.'],
  ]
  return (
    <div className="info-screen">
      <div className="info-card">
        <img className="info-logo" src={FAMILY_CIRCLE_LOGO} alt="Family Circle" />
        <h1>Power Cards</h1>
        <p className="info-intro">Reference for the power effects already implemented in the supplied engine.</p>
        <div className="power-list">
          {cards.map(([name, text]) => (
            <div className="power-row" key={name}>
              <span className="power-name">{name}</span>
              <span className="power-text">{text}</span>
            </div>
          ))}
        </div>
        <button className="btn secondary back-btn" onClick={onBack}>BACK</button>
      </div>
    </div>
  )
}

function GameBody({ state, dispatch }) {
  return (
    <>
      <TablePreview state={state} dispatch={dispatch} />
      <BackgroundMusic enabled />
    </>
  )
}

function TablePreview({ state, dispatch }) {
  const viewPlayer = playerAtSeat(state.players, state.currentSeat)
  const localPlayer = state.mode === 'online'
    ? state.players.find((p) => p.id === state.localPlayerId) || state.players[0]
    : viewPlayer || state.players[0]
  const topCard = state.discard?.[state.discard.length - 1]
  const activeIds = new Set(state.players.filter((p) => !p.out).map((p) => p.id))
  const suggestedIds = new Set(
    suggestedCardIds(
      localPlayer?.hand || [],
      topCard,
      state.requiredSuit,
      state.pendingPickup,
      state.pendingSkip,
    )
  )
  const selectedIds = new Set(state.selectedCardIds)
  const canEndTurn = state.hasDrawnThisTurn && state.pendingPickup === 0 && state.pendingSkip === 0
  const canDraw = state.phase === 'card-play' && !state.hasDrawnThisTurn && state.pendingPickup === 0 && state.pendingSkip === 0
  const selectedCards = (localPlayer?.hand || []).filter((card) => selectedIds.has(card.id))
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const interval = window.setInterval(() => {
      const current = Date.now()
      setNow(current)

      if (state.phase === 'dealing' && state.dealStartedAt && current - state.dealStartedAt >= DEAL_ANIMATION_MS) {
        dispatch({ type: 'DEAL_COMPLETE' })
      } else if (state.transitionStartedAt) {
        const transitionDuration = Math.max(TURN_TRANSITION_MS, (state.recentPlayCards?.length || 0) * PLAY_CARD_STEP_MS + 900)
        if (current - state.transitionStartedAt >= transitionDuration) dispatch({ type: 'TURN_TRANSITION_COMPLETE' })
      } else if (state.phase === 'card-play' && state.turnDeadline && current >= state.turnDeadline) {
        dispatch({ type: 'TURN_TIMEOUT' })
      } else if (state.phase === 'last-card-declare' && state.lastCardDeadline && current >= state.lastCardDeadline) {
        dispatch({ type: 'LAST_CARD_TIMEOUT' })
      } else if (state.phase === 'last-card-challenge' && state.lastCardChallengeDeadline && current >= state.lastCardChallengeDeadline) {
        dispatch({ type: 'LAST_CARD_CHALLENGE_EXPIRED' })
      }
    }, 100)

    return () => window.clearInterval(interval)
  }, [state.phase, state.turnDeadline, state.lastCardDeadline, state.lastCardChallengeDeadline, state.dealStartedAt, dispatch])

  const turnSecondsLeft = state.turnDeadline ? Math.max(0, Math.ceil((state.turnDeadline - now) / 1000)) : null
  const declarationSecondsLeft = state.lastCardDeadline ? Math.max(0, Math.ceil((state.lastCardDeadline - now) / 1000)) : null
  const challengeSecondsLeft = state.lastCardChallengeDeadline ? Math.max(0, Math.ceil((state.lastCardChallengeDeadline - now) / 1000)) : null
  const wholeHandRun = localPlayer && state.phase === 'card-play' && !state.transitionStartedAt
    ? findWholeHandRun(localPlayer.hand, topCard, state.requiredSuit, state.players.filter((p) => !p.out).length)
    : null
  const transitionElapsed = state.transitionStartedAt ? Math.max(0, now - state.transitionStartedAt) : 0
  const transitionCardCount = state.recentPlayCards?.length
    ? Math.min(state.recentPlayCards.length, Math.max(1, Math.floor(transitionElapsed / PLAY_CARD_STEP_MS) + 1))
    : 0
  const transitionMessage = transitionCardCount >= 7 ? 'WHAT A MOVE!' : transitionCardCount >= 5 ? 'GREAT TURN' : transitionCardCount >= 3 ? 'GOOD TURN' : null

  // Seven seats total, always. The local player is visual seat 0 at 6 o'clock.
  // The remaining six seats are evenly spaced around the circle; with seven
  // positions there is intentionally no diametrically opposite seat.
  const seats = Array.from({ length: 7 }, (_, viewSeat) => {
    const player = state.players.find((p) => (
      p.seatIndex === (
        (localPlayer?.seatIndex ?? 0) - viewSeat + 7
      ) % 7
    ))
    return { viewSeat, player }
  })

  return (
    <main className="table-preview-screen">
      <header className="table-preview-header">
        <div className="table-brand">
          <img src={FAMILY_CIRCLE_LOGO} alt="Family Circle" />
          <div>
            <div className="table-brand-name">FAMILY CIRCLE</div>
            <div className="table-brand-sub">THE CARD GAME</div>
          </div>
        </div>
        <div className="table-view-badge">ONLINE VIEW · 7 SEAT TABLE</div>
      </header>

      <section className="table-layout">
        <div className="table-wrap">
          <div className="table-ring" aria-hidden="true" />
          <div className="table-felt">
            <div className="table-inner-ring" aria-hidden="true" />
            <div className="table-piles">
              <div className="table-pile">
                <div className="pile-card pile-card-back">
                  <img
                    src={FAMILY_CIRCLE_LOGO}
                    alt=""
                    aria-hidden="true"
                  />
                </div>
                <span className="pile-label">DRAW PILE</span>
                <strong>{state.deck?.length ?? 0}</strong>
              </div>

              <div className="table-pile">
                <div className={`pile-card pile-card-play suit-${topCard?.rank === 'A' && state.requiredSuit ? state.requiredSuit : (topCard?.suit || 'spades')} ${state.feedback?.success || state.aceSuitChange ? 'pile-play-pulse' : ''}`}>
                  <span>{topCard?.rank ?? 'A'}</span>
                  <small>{topCard ? SUIT_SYMBOL[topCard.rank === 'A' && state.requiredSuit ? state.requiredSuit : topCard.suit] : '♠'}</small>
                </div>
                <span className="pile-label">PLAY PILE</span>
              </div>
            </div>

            <div className="seat-layer">
              {seats.map(({ viewSeat, player }) => {
                const isYou = viewSeat === 0
                const occupied = Boolean(player && activeIds.has(player.id))
                const isDealer = Boolean(player && player.seatIndex === state.dealerSeat)
                return (
                  <div
                    className={`table-seat table-seat-${viewSeat} ${isYou ? 'you' : ''} ${occupied ? 'occupied' : 'empty'}`}
                    key={viewSeat}
                  >
                    <div className="seat-disc">
                      <span>{isYou ? 'YOU' : occupied ? player.name.slice(0, 8) : 'OPEN'}</span>
                    </div>
                    {isDealer && <div className="dealer-button">DEALER</div>}
                    <div className="seat-caption">
                      {isYou ? 'YOU · 6 O\'CLOCK' : occupied ? `${player.name} · ${player.hand.length} CARDS` : 'OPEN SEAT'}
                    </div>
                    {occupied && !isYou && (
                      <div className="hidden-hand-preview" aria-label={`${player.name} has ${player.hand.length} cards`}>
                        {Array.from({ length: Math.min(player.hand.length, 5) }, (_, cardIndex) => (
                          <div className="mini-card-back" key={cardIndex}>
                            <img src={FAMILY_CIRCLE_LOGO} alt="" aria-hidden="true" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {state.transitionStartedAt && (
          <div className="turn-transition-overlay" aria-live="polite">
            <div className="turn-transition-card"><img src={FAMILY_CIRCLE_LOGO} alt="" aria-hidden="true" /></div>
            <div className="turn-transition-brand">FAMILY CIRCLE</div>
            {state.pickupAnimation ? (
              <div className={`pickup-power-event pickup-power-${Math.min(state.pickupAnimation.amount, 18)}`} aria-live="polite">
                <div className="pickup-power-burst">⚡</div>
                <div className="pickup-power-title">PICK UP {state.pickupAnimation.amount}</div>
                <div className="pickup-power-sub">{state.transitionPlayerName || 'Player'} PLAYED A POWER CARD</div>
                <div className="pickup-power-cards">
                  {(state.recentPlayCards || []).map((card) => (
                    <div className={`pickup-power-card suit-${card.suit}`} key={card.id}>
                      <b>{card.rank}</b><small>{SUIT_SYMBOL[card.suit]}</small>
                    </div>
                  ))}
                </div>
                <div className="pickup-power-note">{state.pickupAnimation.amount >= 12 ? 'MASSIVE PICKUP!' : state.pickupAnimation.amount >= 8 ? 'BIG PICKUP!' : state.pickupAnimation.amount >= 4 ? 'POWER STACK!' : 'POWER CARD!'}</div>
              </div>
            ) : state.aceSuitChange ? (
              <div className="ace-suit-change" aria-live="polite">
                <div className="ace-change-card suit-ace">
                  <span className="ace-change-rank">A</span>
                  <span className={`ace-change-suit suit-${state.aceSuitChange.suit}`}>{SUIT_SYMBOL[state.aceSuitChange.suit]}</span>
                  <span className="ace-change-arrow">↓</span>
                  <strong>{state.aceSuitChange.suit.toUpperCase()}</strong>
                </div>
                <div className="ace-change-title">{state.aceSuitChange.playerName} CHANGED THE SUIT TO</div>
                <div className={`ace-change-suit-name suit-${state.aceSuitChange.suit}`}>{SUIT_SYMBOL[state.aceSuitChange.suit]} {state.aceSuitChange.suit.toUpperCase()}</div>
              </div>
            ) : (
              <>
                <div className="turn-transition-title">{state.transitionPlayerName || 'Player'}'S TURN FINISHED</div>
                {state.recentPlayCards?.length > 0 && (
              <div className="turn-play-animation">
                {state.recentPlayCards.map((card, index) => (
                  <div className={`transition-playing-card suit-${card.suit}`} key={card.id} style={{ '--play-delay': (index * PLAY_CARD_STEP_MS) + 'ms' }}>
                    <span>{card.rank}</span><small>{SUIT_SYMBOL[card.suit]}</small>
                  </div>
                ))}
              </div>
            )}
                {transitionMessage && <div className="turn-move-counter" key={transitionCardCount}><b>{transitionCardCount} CARDS!</b><span>{transitionMessage}</span></div>}
              </>
            )}
            <div className="turn-next-label">NEXT TURN</div>
            <div className="turn-next-player">{viewPlayer?.name || 'Next Player'}</div>
            <div className="turn-transition-dots"><span /><span /><span /></div>
          </div>
        )}

        {state.phase === 'dealing' && (
          <div className="deal-overlay" aria-live="polite">
            <div className="deal-animation-card">
              <img src={FAMILY_CIRCLE_LOGO} alt="" aria-hidden="true" />
            </div>
            <div className="deal-overlay-title">DEALING</div>
            <div className="deal-overlay-sub">7 CARDS EACH · DEALER DEALS LEFT</div>
            <div className="deal-card-trail" aria-hidden="true">
              {[0,1,2,3,4,5,6].map((i) => <span key={i} style={{'--deal-delay': (i * 0.12) + 's'}} />)}
            </div>
          </div>
        )}

        <div className="table-hand">
          <div className="turn-banner">
            <div>
              <span className="turn-kicker">{state.mode === 'online' ? 'YOUR TURN' : 'DEMO TURN'}</span>
              <strong>{localPlayer?.name || 'Player'}</strong>
            </div>
            <span className="turn-status">
              {state.phase === 'card-play' && state.turnDeadline ? (
                <span className="turn-timer" aria-label="turn time remaining">
                  <b>{turnSecondsLeft ?? 30}</b><small>SEC</small>
                </span>
              ) : null}
              {state.phase === 'dealing'
                ? 'DEALING CARDS'
                : state.phase === 'last-card-declare'
                  ? `DECLARE LAST CARD · ${declarationSecondsLeft ?? 0}`
                  : state.phase === 'last-card-challenge'
                    ? `CHALLENGE WINDOW · ${challengeSecondsLeft ?? 0}`
                    : state.pendingPickup > 0
                      ? `PICK UP ${state.pendingPickup} OR STACK`
                      : state.pendingSkip > 0
                        ? 'PLAY AN 8 OR ACCEPT SKIP'
                        : state.hasDrawnThisTurn
                          ? 'CARD DRAWN · END TURN READY'
                          : 'SELECT A CARD OR DRAW'}
            </span>
          </div>

          {(state.phase === 'suit-pick' || state.phase === 'suit-pick-last-card') && (
          <div className="suit-picker">
            <div>
              <strong>ACE — CHOOSE THE NEXT SUIT</strong>
              <span>The Ace is wild. Pick the suit the next player must follow.</span>
            </div>
            <div className="suit-picker-buttons">
              {['spades', 'hearts', 'diamonds', 'clubs'].map((suit) => (
                <button
                  key={suit}
                  className={`btn secondary suit-choice suit-${suit}`}
                  onClick={() => dispatch({ type: 'CHOOSE_SUIT', payload: suit })}
                >
                  {SUIT_SYMBOL[suit]} {suit.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        )}

        {state.feedback?.error && (
            <div className="game-feedback error">{state.feedback.error}</div>
          )}

          <div className="hand-heading">
            <span>YOUR HAND</span>
            <strong>{localPlayer?.hand.length ?? 0} CARDS</strong>
            {suggestedIds.size > 0 && <em>{suggestedIds.size} SUGGESTED</em>}
          </div>

          <div className="hand-cards">
            {(localPlayer?.hand || []).map((card) => {
              const suggested = suggestedIds.has(card.id)
              const selected = selectedIds.has(card.id)
              return (
                <button
                  className={`playing-card face-card suit-${card.suit} ${suggested ? 'suggested' : ''} ${selected ? 'selected' : ''}`}
                  key={card.id}
                  onClick={() => dispatch({ type: 'TOGGLE_CARD', payload: card.id })}
                  aria-label={`${card.rank} of ${card.suit}`}
                >
                  <span className="card-corner top-left">
                    <b>{card.rank}</b><small>{SUIT_SYMBOL[card.suit]}</small>
                  </span>
                  <span className={`card-suit-large suit-${card.suit}`}>{SUIT_SYMBOL[card.suit]}</span>
                  <span className="card-corner bottom-right">
                    <b>{card.rank}</b><small>{SUIT_SYMBOL[card.suit]}</small>
                  </span>
                  {suggested && <span className="suggested-dot" aria-hidden="true" />}
                </button>
              )
            })}
          </div>

          {state.phase === 'last-card-declare' && (
            <div className="last-card-panel">
              <div className="last-card-count">{declarationSecondsLeft ?? 0}</div>
              <div>
                <strong>DECLARE LAST CARD</strong>
                <span>You have one card left. You have 3 seconds.</span>
              </div>
              <button className="btn primary" onClick={() => dispatch({ type: 'DECLARE_LAST_CARD' })}>LAST CARD</button>
            </div>
          )}

          {state.phase === 'last-card-challenge' && (
            <div className="last-card-panel challenge">
              <div className="last-card-count">{challengeSecondsLeft ?? 0}</div>
              <div>
                <strong>CHALLENGE LAST CARD</strong>
                <span>Challenge within 3 seconds if the declaration was missed.</span>
              </div>
              <button className="btn primary" onClick={() => dispatch({ type: 'CHALLENGE_LAST_CARD' })}>CHALLENGE</button>
            </div>
          )}

          {wholeHandRun && (
            <div className="last-cards-option">
              <span>WHOLE HAND RUN · YOU CAN CLEAR YOUR HAND</span>
              <button className="btn secondary" onClick={() => dispatch({ type: 'DECLARE_LAST_CARDS' })}>DECLARE LAST CARDS</button>
            </div>
          )}

          {state.phase !== 'last-card-declare' && state.phase !== 'last-card-challenge' && state.phase !== 'suit-pick' && state.phase !== 'suit-pick-last-card' && (
          <div className="table-controls">
            {state.pendingPickup > 0 ? (
              <>
                <button
                  className="btn primary"
                  disabled={selectedCards.length === 0}
                  onClick={() => dispatch({ type: 'PLAY_PICKUP_RESPONSE' })}
                >
                  PLAY ON TOP
                </button>
                <button className="btn secondary" onClick={() => dispatch({ type: 'DRAW_PICKUP' })}>
                  PICK UP {state.pendingPickup}
                </button>
              </>
            ) : state.pendingSkip > 0 ? (
              <>
                <button
                  className="btn primary"
                  disabled={selectedCards.length === 0}
                  onClick={() => dispatch({ type: 'PLAY_SELECTED' })}
                >
                  PLAY 8
                </button>
                <button className="btn secondary" onClick={() => dispatch({ type: 'ACCEPT_SKIP' })}>
                  ACCEPT SKIP
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn primary"
                  disabled={selectedCards.length === 0}
                  onClick={() => dispatch({ type: 'PLAY_SELECTED' })}
                >
                  PLAY {selectedCards.length ? `${selectedCards.length} CARD${selectedCards.length > 1 ? 'S' : ''}` : 'CARD'}
                </button>
                <button className="btn secondary" disabled={!canDraw} onClick={() => dispatch({ type: 'DRAW_ONE' })}>
                  DRAW CARD
                </button>
                <button className="btn secondary" disabled={!canEndTurn} onClick={() => dispatch({ type: 'END_TURN' })}>
                  END TURN
                </button>
              </>
            )}
          </div>
          )}

          <div className="table-demo-note">
            <span>{state.mode === 'online' ? 'ONLINE TABLE VIEW' : 'LOCAL DEMO VIEW'}</span>
            <p>Seven fixed seats. Your view keeps you at 6 o'clock. Suggested cards are assistance only; you choose every play.</p>
          </div>
        </div>
      </section>

      {state.phase === 'round-over' && (
        <div className="winner-overlay" role="dialog" aria-modal="true">
          <div className="confetti" aria-hidden="true">
            {Array.from({ length: 64 }, (_, i) => {
              const x = (i * 47 + 13) % 100
              const y = -12 - ((i * 19) % 42)
              const delay = -((i % 18) * 0.16)
              const duration = 4.6 + ((i * 7) % 18) / 10
              const drift = ((i * 37) % 180) - 90
              const rotate = ((i * 61) % 70) - 35
              const size = 5 + (i % 4)
              return (
                <span
                  key={i}
                  className={i % 5 === 0 ? 'confetti-piece confetti-wide' : 'confetti-piece'}
                  style={{
                    '--confetti-x': x + '%',
                    '--confetti-y': y + 'vh',
                    '--confetti-delay': delay + 's',
                    '--confetti-duration': duration + 's',
                    '--confetti-drift': drift + 'px',
                    '--confetti-drift-end': (drift * -0.35) + 'px',
                    '--confetti-rotate': rotate + 'deg',
                    '--confetti-size': size + 'px',
                    '--confetti-height': (size * 1.85) + 'px',
                  }}
                />
              )
            })}
          </div>
          <div className="winner-card">
            <div className="winner-kicker">FAMILY CIRCLE · {state.gameMode === 'knockout' ? 'KNOCKOUT' : 'WINNER TAKES ALL'}</div>
            <div className="winner-title">WINNER!</div>
            <div className="winner-name">{state.players.find((p) => p.id === state.winner)?.name || 'Player'}</div>
            <div className="winner-subtitle">{state.gameMode === 'knockout' ? 'ROUND WINNER' : 'FIRST PLAYER TO CLEAR THEIR HAND'}</div>
            <div className="winner-actions">
              <button className="btn primary big" onClick={() => dispatch({ type: 'PLAY_AGAIN' })}>PLAY ANOTHER GAME</button>
              <button className="btn secondary" onClick={() => dispatch({ type: 'GO_HOME' })}>HOME</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

// ---------- online lobby prototype ----------

function LobbyShell({ title, subtitle, children, onBack, onHome }) {
  return (
    <main className="lobby-screen">
      <div className="lobby-orbit lobby-orbit-a" aria-hidden="true" />
      <div className="lobby-orbit lobby-orbit-b" aria-hidden="true" />
      <section className="lobby-card">
        <img className="lobby-logo" src={FAMILY_CIRCLE_LOGO} alt="Family Circle" />
        <div className="lobby-kicker">FAMILY CIRCLE · ONLINE</div>
        <h1>{title}</h1>
        <p className="lobby-subtitle">{subtitle}</p>
        {children}
        <div className="lobby-footer-actions">
          <button className="btn secondary" onClick={onBack}>← BACK</button>
          <button className="text-link" onClick={onHome}>HOME</button>
        </div>
      </section>
    </main>
  )
}

function LobbyHomeScreen({ onBack, onCreate, onJoin }) {
  return (
    <LobbyShell title="ONLINE LOBBY" subtitle="Create a private game for your family, or join one with a game code." onBack={onBack} onHome={onBack}>
      <div className="lobby-choice-grid">
        <button className="lobby-choice create" onClick={onCreate}>
          <span className="lobby-choice-icon">＋</span>
          <strong>CREATE GAME</strong>
          <small>You become the host and receive a private game code.</small>
        </button>
        <button className="lobby-choice join" onClick={onJoin}>
          <span className="lobby-choice-icon">↗</span>
          <strong>JOIN GAME</strong>
          <small>Enter a 6-character code from the game host.</small>
        </button>
      </div>
      <div className="lobby-note"><b>TEST MODE</b><span>The lobby UI is being tested locally first. Live cross-device rooms will connect to Supabase next.</span></div>
    </LobbyShell>
  )
}

function LobbyCreateScreen({ onBack, onHome, onStart }) {
  const [name, setName] = useState('Player 1')
  const [count, setCount] = useState(4)
  const [players, setPlayers] = useState([{ id: 'host', name: 'Player 1', host: true, ready: true }])
  const [code] = useState(() => Math.random().toString(36).slice(2, 8).toUpperCase())

  const addTestPlayer = () => {
    if (players.length >= count) return
    const n = players.length + 1
    setPlayers([...players, { id: 'test-' + n, name: 'Player ' + n, host: false, ready: true }])
  }
  const start = () => {
    const gamePlayers = players.map((p, i) => ({ id: 'p' + i, name: p.name }))
    onStart({ players: gamePlayers, handSize: 7, mode: 'local-demo', gameMode: 'winner-takes-all', localPlayerId: 'p0' })
  }

  return (
    <LobbyShell title="CREATE GAME" subtitle="Set your name, choose the player limit, then share the code." onBack={onBack} onHome={onHome}>
      <div className="lobby-code-card">
        <span>GAME CODE</span>
        <strong>{code}</strong>
        <small>Share this code with the players you want to invite.</small>
      </div>

      <label className="lobby-field">
        <span>YOUR NAME</span>
        <input className="text-input" value={name} onChange={e => {
          const value = e.target.value.slice(0, 18)
          setName(value)
          setPlayers(ps => ps.map((p, i) => i === 0 ? { ...p, name: value || 'Player 1' } : p))
        }} />
      </label>

      <div className="lobby-field">
        <span>MAX PLAYERS</span>
        <div className="player-count-options">
          {[2,3,4,5,6,7].map(n => <button key={n} className={`player-count-option ${count === n ? 'active' : ''}`} onClick={() => setCount(n)}>{n}</button>)}
        </div>
      </div>

      <div className="lobby-players">
        <div className="lobby-section-heading"><span>PLAYERS</span><b>{players.length}/{count}</b></div>
        {players.map((p, i) => (
          <div className="lobby-player-row" key={p.id}>
            <div className="lobby-avatar">{i === 0 ? 'H' : i + 1}</div>
            <div><strong>{p.name}</strong><small>{p.host ? 'HOST' : 'READY'}</small></div>
            {p.host && <em>HOST</em>}
          </div>
        ))}
        {Array.from({ length: Math.max(0, count - players.length) }, (_, i) => (
          <div className="lobby-player-row open" key={'open' + i}><div className="lobby-avatar">+</div><div><strong>Waiting for player…</strong><small>OPEN SEAT</small></div></div>
        ))}
      </div>

      <button className="btn secondary lobby-test-add" disabled={players.length >= count} onClick={addTestPlayer}>＋ ADD TEST PLAYER</button>
      <button className="btn primary big lobby-start" disabled={players.length < 2} onClick={start}>START GAME · {players.length} PLAYERS</button>
      <p className="lobby-test-caption">The “Add Test Player” button is temporary scaffolding for UI testing. Supabase will replace it with real players.</p>
    </LobbyShell>
  )
}

function LobbyJoinScreen({ onBack, onHome }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('Player')
  const [joined, setJoined] = useState(false)

  if (joined) {
    return (
      <LobbyShell title="WAITING ROOM" subtitle="You have joined the test room. The host controls when the game starts." onBack={() => setJoined(false)} onHome={onHome}>
        <div className="lobby-code-card compact"><span>GAME CODE</span><strong>{code}</strong></div>
        <div className="lobby-players">
          <div className="lobby-section-heading"><span>ROOM</span><b>2/7</b></div>
          <div className="lobby-player-row"><div className="lobby-avatar">H</div><div><strong>Host</strong><small>HOST · READY</small></div><em>HOST</em></div>
          <div className="lobby-player-row"><div className="lobby-avatar">Y</div><div><strong>{name || 'Player'}</strong><small>YOU · READY</small></div><em>YOU</em></div>
        </div>
        <div className="lobby-note"><b>WAITING</b><span>When Supabase is connected, this list will update instantly as family members join or leave.</span></div>
      </LobbyShell>
    )
  }

  return (
    <LobbyShell title="JOIN GAME" subtitle="Enter the host's game code and the name you want other players to see." onBack={onBack} onHome={onHome}>
      <label className="lobby-field"><span>YOUR NAME</span><input className="text-input" value={name} onChange={e => setName(e.target.value.slice(0,18))} /></label>
      <label className="lobby-field"><span>GAME CODE</span><input className="text-input lobby-code-input" value={code} maxLength={6} onChange={e => setCode(e.target.value.replace(/[^a-z0-9]/gi,'').toUpperCase())} placeholder="ABC123" /></label>
      <button className="btn primary big" disabled={code.length !== 6 || !name.trim()} onClick={() => setJoined(true)}>JOIN GAME</button>
      <p className="lobby-test-caption">Local test mode: entering any 6-character code opens the waiting-room preview. Real room validation comes with Supabase.</p>
    </LobbyShell>
  )
}

// ---------- setup ----------

function SetupScreen({ onBack, onStart }) {
  const [count, setCount] = useState(4)
  const [names, setNames] = useState(['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5', 'Player 6', 'Player 7'])
  const [gameMode, setGameMode] = useState('winner-takes-all')
  function handleStart() {
    const players = Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      name: names[i] || `Player ${i + 1}`,
    }))
    onStart({ players, handSize: 7, mode: 'local-demo', gameMode, localPlayerId: players[0]?.id })
  }

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <img className="setup-logo" src={FAMILY_CIRCLE_LOGO} alt="Family Circle" />
        <h1>Family Circle</h1>
        <p className="setup-tag">Together Always — set up tonight’s game</p>

        <button className="text-link back-link" onClick={onBack}>← Back</button>
        <div className="setup-dealer-note">Dealer: <strong>Random</strong> — the game chooses the opening dealer automatically.</div>

        <div className="player-count-label">NUMBER OF PLAYERS <strong>{count}</strong></div>
        <div className="player-count-options" role="group" aria-label="Number of players">
          {[2, 3, 4, 5, 6, 7].map((number) => (
            <button
              key={number}
              type="button"
              className={`player-count-option ${count === number ? 'active' : ''}`}
              onClick={() => setCount(number)}
              aria-pressed={count === number}
            >
              {number}
            </button>
          ))}
        </div>

        <div className="player-names-label">PLAYER NAMES</div>

        <div className="name-grid">
          {Array.from({ length: count }).map((_, i) => (
            <input
              key={i}
              className="text-input"
              value={names[i]}
              onChange={(e) => {
                const next = names.slice()
                next[i] = e.target.value
                setNames(next)
              }}
              placeholder={`Player ${i + 1} name`}
            />
          ))}
        </div>

        <details className="settings-details" open>
          <summary>Game settings</summary>
          <p className="hint">Each player starts with 7 cards. The dealer shuffles, deals first, and play moves left. Each turn has 30 seconds.</p>
        </details>

        <div className="game-mode-section">
          <div className="player-names-label">GAME MODE</div>
          <div className="game-mode-options" role="group" aria-label="Game mode">
            <button type="button" className={`game-mode-option ${gameMode === 'winner-takes-all' ? 'active' : ''}`} onClick={() => setGameMode('winner-takes-all')} aria-pressed={gameMode === 'winner-takes-all'}>
              <strong>WINNER TAKES ALL</strong>
              <span>First player to get rid of every card wins.</span>
            </button>
            <button type="button" className={`game-mode-option ${gameMode === 'knockout' ? 'active' : ''}`} onClick={() => setGameMode('knockout')} aria-pressed={gameMode === 'knockout'}>
              <strong>KNOCKOUT</strong>
              <span>Knockout format — detailed elimination rules will be added before knockout play is activated.</span>
            </button>
          </div>
        </div>

        <button className="btn primary big" onClick={handleStart}>START GAME</button>
      </div>
    </div>
  )
}
