import { useReducer, useState } from 'react'
import {
  SUIT_SYMBOL,
  makeDeck,
  shuffle,
  dealHands,
  canLeadWith,
  validateRunChain,
  canFinishOn,
  canCounterPickup,
  isRedJack,
  isBlackJack,
  computePlayEffect,
} from './game/engine.js'
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

function nextActiveIndex(players, fromIndex, direction, extraSkips = 0) {
  const n = players.length
  let idx = fromIndex
  let steps = 1 + extraSkips
  let guard = 0
  let count = 0
  while (count < steps && guard < 100) {
    idx = (idx + direction + n) % n
    guard++
    if (!players[idx].out) count++
  }
  return idx
}

// ---------- initial / reducer ----------

const initialState = { phase: 'home' }

function startNewGame(setup, dealerIndexOverride = null) {
  const { players: rawPlayers, handSize } = setup
  const deck = shuffle(makeDeck())
  const { hands, remainingDeck } = dealHands(deck, rawPlayers.length, handSize)
  const players = rawPlayers.map((p, i) => ({
    ...p,
    hand: hands[i],
    out: false,
  }))
  // first discard: flip from the remaining deck, keep flipping if it happens
  // to be an Ace (so nobody starts by having to guess a wild suit).
  let deckLeft = remainingDeck.slice()
  let firstCard = deckLeft.shift()
  const bottomBuffer = []
  while (firstCard && firstCard.rank === 'A' && deckLeft.length > 0) {
    bottomBuffer.push(firstCard)
    firstCard = deckLeft.shift()
  }
  deckLeft = [...deckLeft, ...bottomBuffer]

  const dealerIndex = Number.isInteger(dealerIndexOverride)
    ? dealerIndexOverride
    : Math.floor(Math.random() * players.length)

  return {
    phase: 'pass-device',
    settings: { handSize },
    players,
    dealerIndex,
    currentPlayerIndex: dealerIndex,
    direction: -1,
    deck: deckLeft,
    discard: [firstCard],
    requiredSuit: null,
    pendingPickup: 0,
    selectedCardIds: [],
    hasDrawnThisTurn: false,
    feedback: null,
    log: [`New round dealt. ${players[dealerIndex].name} is the random dealer and starts. ${firstCard.rank} of ${firstCard.suit} starts the pile.`],
    winner: null,
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
      return { phase: 'setup' }

    case 'SHOW_RULES':
      return { phase: 'rules' }

    case 'SHOW_POWER_CARDS':
      return { phase: 'power-cards' }

    case 'READY_FOR_CARDS': {
      const base = { ...state, feedback: null, selectedCardIds: [], hasDrawnThisTurn: false }
      return { ...base, phase: state.pendingPickup > 0 ? 'pickup-response' : 'card-play' }
    }

    case 'TOGGLE_CARD': {
      const id = action.payload
      const sel = state.selectedCardIds
      if (sel.length && sel[sel.length - 1] === id) {
        return { ...state, selectedCardIds: sel.slice(0, -1) }
      }
      if (sel.includes(id)) return state
      return { ...state, selectedCardIds: [...sel, id] }
    }

    case 'CLEAR_SELECTION':
      return { ...state, selectedCardIds: [] }

    case 'PLAY_PICKUP_RESPONSE': {
      const player = state.players[state.currentPlayerIndex]
      const cards = state.selectedCardIds.map((id) => player.hand.find((c) => c.id === id))
      if (cards.length === 0) return state

      const allRedJackSingle = cards.length === 1 && isRedJack(cards[0])
      const allCounters = cards.every((c) => canCounterPickup(c))
      if (!allRedJackSingle && !allCounters) {
        return { ...state, feedback: { error: 'Pick only 2s / Black Jacks to stack, or a single Red Jack to cancel.' } }
      }

      const newHand = player.hand.filter((c) => !state.selectedCardIds.includes(c.id))
      if (newHand.length === 0 && !cards.some((c) => c.rank === '7')) {
        return { ...state, feedback: { error: "You can't finish your hand on a power card — draw the pickup instead." } }
      }

      const players = state.players.slice()
      players[state.currentPlayerIndex] = { ...player, hand: newHand }
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
          { ...state, players, discard, pendingPickup: 0, phase: 'round-over', winner: player.id },
          `${player.name} goes out!`
        )
      }

      const nextState = pushLog({ ...state, players, discard, pendingPickup, requiredSuit: null }, logLine)
      return endTurn(nextState, { skipAdd: 0, reverseCount: 0 })
    }

    case 'DRAW_PICKUP': {
      const player = state.players[state.currentPlayerIndex]
      const { drawn, deck, discard } = drawCards(state.deck, state.discard, state.pendingPickup)
      const players = state.players.slice()
      players[state.currentPlayerIndex] = { ...player, hand: [...player.hand, ...drawn] }
      const nextState = pushLog(
        { ...state, players, deck, discard, pendingPickup: 0 },
        `${player.name} picked up ${drawn.length} card(s).`
      )
      return endTurn(nextState, { skipAdd: 0, reverseCount: 0 })
    }

    case 'DRAW_ONE': {
      if (state.hasDrawnThisTurn) return state
      const player = state.players[state.currentPlayerIndex]
      const { drawn, deck, discard } = drawCards(state.deck, state.discard, 1)
      const players = state.players.slice()
      players[state.currentPlayerIndex] = { ...player, hand: [...player.hand, ...drawn] }
      return pushLog(
        { ...state, players, deck, discard, hasDrawnThisTurn: true },
        `${player.name} drew a card.`
      )
    }


    case 'PLAY_SELECTED': {
      const player = state.players[state.currentPlayerIndex]
      const cards = state.selectedCardIds.map((id) => player.hand.find((c) => c.id === id))
      if (cards.length === 0) return state

      const topCard = state.discard[state.discard.length - 1]
      if (!canLeadWith(cards[0], topCard, state.requiredSuit)) {
        return { ...state, feedback: { error: `That doesn't connect to the ${topCard.rank} of ${topCard.suit}${state.requiredSuit ? ` (must be ${state.requiredSuit})` : ''}.` } }
      }
      if (!validateRunChain(cards)) {
        return { ...state, feedback: { error: 'Those cards don\u2019t form a valid connected run.' } }
      }

      const newHand = player.hand.filter((c) => !state.selectedCardIds.includes(c.id))
      const finishing = newHand.length === 0
      if (finishing && !canFinishOn(cards[cards.length - 1])) {
        return { ...state, feedback: { error: 'You can\u2019t finish your hand on that power card.' } }
      }

      const players = state.players.slice()
      players[state.currentPlayerIndex] = { ...player, hand: newHand }
      const discard = [...state.discard, ...cards]
      const effect = computePlayEffect(cards)

      let nextState = pushLog(
        { ...state, players, discard, requiredSuit: effect.power === 'ace' ? state.requiredSuit : null },
        `${player.name} played ${cards.map((c) => `${c.rank}${SUIT_SYMBOL[c.suit]}`).join(' \u2192 ')}.`
      )

      if (finishing) {
        return { ...nextState, phase: 'round-over', winner: player.id }
      }

      if (effect.cancelPickup) nextState = { ...nextState, pendingPickup: 0 }
      else if (effect.pickupAdd) nextState = { ...nextState, pendingPickup: nextState.pendingPickup + effect.pickupAdd }

      if (effect.needsSuitChoice) {
        return { ...nextState, phase: 'suit-pick', pendingEffect: effect }
      }

      return endTurn(nextState, effect)
    }

    case 'CHOOSE_SUIT': {
      const withSuit = { ...state, requiredSuit: action.payload, pendingEffect: undefined }
      return endTurn(withSuit, state.pendingEffect || {})
    }

    case 'PLAY_AGAIN': {
      const setup = {
        players: state.players.map((p) => ({ id: p.id, name: p.name })),
        handSize: state.settings.handSize,
      }
      const nextDealer = nextActiveIndex(state.players, state.dealerIndex, -1)
      return startNewGame(setup, nextDealer)
    }

    default:
      return state
  }
}

function endTurn(state, effect) {
  let direction = state.direction
  if (effect.reverseCount && effect.reverseCount % 2 === 1) direction = direction * -1
  const nextIndex = nextActiveIndex(state.players, state.currentPlayerIndex, direction, effect.skipAdd || 0)
  return {
    ...state,
    direction,
    currentPlayerIndex: nextIndex,
    phase: 'pass-device',
    selectedCardIds: [],
    hasDrawnThisTurn: false,
    feedback: null,
  }
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
  return (
    <main className="home-screen">
      <div className="home-orbit orbit-one" aria-hidden="true" />
      <div className="home-orbit orbit-two" aria-hidden="true" />
      <div className="home-glow glow-pink" aria-hidden="true" />
      <div className="home-glow glow-blue" aria-hidden="true" />

      <section className="home-card" aria-label="Family Circle card game">
        <div className="home-hero">
          <img
            className="home-logo"
            src={`${import.meta.env.BASE_URL}logo.webp`}
            alt="Family Circle — Together Always"
          />
          <div className="home-kicker">THE CARD GAME</div>
          <p className="home-copy">A private family card game for 2–7 players.</p>
        </div>

        <div className="home-actions">
          <button className="btn primary big home-play" onClick={onPlay}>
            PLAY A GAME
          </button>

          <div className="home-secondary">
            <button className="btn secondary" onClick={onRules}>RULES</button>
            <button className="btn secondary" onClick={onPowerCards}>POWER CARDS</button>
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
        <img className="info-logo" src={`${import.meta.env.BASE_URL}logo.webp`} alt="Family Circle" />
        <h1>Family Circle Rules</h1>
        <p className="info-intro">Card-game rules reference.</p>
        <div className="info-grid">
          <div><strong>Players</strong><span>2–7 players</span></div>
          <div><strong>Cards</strong><span>Standard 52-card deck</span></div>
          <div><strong>Starting hand</strong><span>7 cards by default</span></div>
          <div><strong>Turn</strong><span>Dealer starts; play then moves to the left</span></div>
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
    ['7', 'Reverses direction. It cannot be the final card.'],
    ['8', 'Skips the next player and can be stacked/cancelled by another 8.'],
    ['Red Jack', 'Cancels an active pickup.'],
    ['Black Jack', '+5 pickup and stacks with 2s and other Black Jacks.'],
  ]
  return (
    <div className="info-screen">
      <div className="info-card">
        <img className="info-logo" src={`${import.meta.env.BASE_URL}logo.webp`} alt="Family Circle" />
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

function GameBody({ state }) {
  const phaseLabel = {
    'pass-device': 'Game table',
    'pickup-response': 'Pickup response',
    'card-play': 'Card play',
    'suit-pick': 'Suit choice',
    'round-over': 'Round complete',
  }[state.phase] || 'Game';

  return (
    <div className="stage2-screen">
      <section className="stage2-card" aria-label="Family Circle Card Game Stage 2 placeholder">
        <img
          className="stage2-logo"
          src={`${import.meta.env.BASE_URL}logo.webp`}
          alt="Family Circle — Together Always"
        />
        <div className="stage2-kicker">STAGE 1</div>
        <h1>Home experience ready</h1>
        <p>
          The old table interface has been removed from the presentation layer.
          The seven-seat online table will be rebuilt from the approved reference
          in Stage 2.
        </p>
        <div className="stage2-note">
          <span>Current game state</span>
          <strong>{phaseLabel}</strong>
        </div>
        <p className="stage2-footnote">
          The card rules engine remains in <code>src/game/engine.js</code>; this screen
          is only a temporary stage boundary.
        </p>
      </section>
    </div>
  )
}

// ---------- setup ----------

function SetupScreen({ onBack, onStart }) {
  const [count, setCount] = useState(4)
  const [names, setNames] = useState(['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5', 'Player 6', 'Player 7'])
  const [handSize, setHandSize] = useState(7)

  function handleStart() {
    const players = Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      name: names[i] || `Player ${i + 1}`,
    }))
    onStart({ players, handSize })
  }

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <img className="setup-logo" src={`${import.meta.env.BASE_URL}logo.webp`} alt="Family Circle" />
        <h1>Family Circle</h1>
        <p className="setup-tag">Together Always — set up tonight’s game</p>

        <button className="text-link back-link" onClick={onBack}>← Back</button>
        <div className="setup-dealer-note">Dealer: <strong>Random</strong> — the game chooses the opening dealer automatically.</div>

        <label className="field-label">Number of players ({count})</label>
        <input type="range" min="2" max="7" value={count} onChange={(e) => setCount(Number(e.target.value))} />

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
          <label className="field-label">Starting hand size ({handSize})</label>
          <input type="range" min="7" max="7" value={handSize} onChange={(e) => setHandSize(Number(e.target.value))} disabled />
          <p className="hint">Each player is dealt 7 cards. The opening dealer is selected randomly, and play starts with the dealer before moving left.</p>
        </details>

        <button className="btn primary big" onClick={handleStart}>START GAME</button>
      </div>
    </div>
  )
}
