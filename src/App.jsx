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
    gameEvent: null,
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
        // Pickup responses can only be 2s, Black Jacks, or a Red Jack, so
        // an Ace suit-selection branch is never possible here. If the
        // response leaves one card, use the normal Last Card declaration.
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
          gameEvent: {
            kind: 'last-card',
            title: 'LAST CARD!',
            main: player.name + ' CALLED LAST CARD',
            detail: 'EVERYONE — WATCH THE TABLE',
          },
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
        gameEvent: null,
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
  const nextPlayer = playerAtSeat(state.players, nextSeat)
  const playedCard = state.recentPlayCards?.[state.recentPlayCards.length - 1]
  let gameEvent = state.gameEvent || null

  if (playedCard?.rank === '7' && effect.reverseCount % 2 === 1) {
    gameEvent = {
      kind: 'reverse',
      title: 'ORDER REVERSED',
      main: (finishingPlayer?.name || 'Player') + ' PLAYS 7',
      detail: 'TURN DIRECTION CHANGED · NEXT: ' + (nextPlayer?.name || 'PLAYER'),
    }
  } else if (playedCard?.rank === '8' && effect.skipAdd) {
    gameEvent = {
      kind: 'skip',
      title: 'PLAYER SKIPPED',
      main: (finishingPlayer?.name || 'Player') + ' PLAYS 8',
      detail: (nextPlayer?.name || 'PLAYER') + "'S TURN IS SKIPPED",
    }
  } else if (effect.pickupAdd) {
    const pickupAmount = (state.pendingPickup || 0) + effect.pickupAdd
    gameEvent = {
      kind: 'pickup',
      title: 'PICK UP ' + pickupAmount,
      main: (finishingPlayer?.name || 'Player') + ' PLAYS ' + (playedCard?.rank || 'POWER CARD'),
      detail: 'NEXT: ' + (nextPlayer?.name || 'PLAYER'),
    }
  } else if (effect.cancelPickup) {
    gameEvent = {
      kind: 'cancel',
      title: 'PICKUP CANCELLED',
      main: (finishingPlayer?.name || 'Player') + ' PLAYS RED JACK',
      detail: 'NEXT: ' + (nextPlayer?.name || 'PLAYER'),
    }
  } else if (effect.needsSuitChoice) {
    gameEvent = {
      kind: 'ace',
      title: 'ACE — CHOOSE A SUIT',
      main: (finishingPlayer?.name || 'Player') + ' PLAYS ACE',
      detail: 'THE NEXT SUIT WILL BE CHOSEN',
    }
  }

  const shouldTransition = Boolean(finishingPlayer)
  return {
    ...state,
    direction,
    currentSeat: nextSeat,
    gameEvent,
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