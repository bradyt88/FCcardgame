import { useReducer, useState, useMemo } from 'react'
import {
  SUITS,
  SUIT_SYMBOL,
  SUIT_LABEL,
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
  isRed,
} from './game/engine.js'
import { drawQuestions } from './game/questions.js'

const TEAM_COLORS = { A: '#79f5ff', B: '#ff9ecb', none: '#d8c98e' }

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
  const { players: rawPlayers, handSize, wrongAnswerSkipsPlay } = setup
  const deck = shuffle(makeDeck())
  const { hands, remainingDeck } = dealHands(deck, rawPlayers.length, handSize)
  const players = rawPlayers.map((p, i) => ({
    ...p,
    hand: hands[i],
    score: 0,
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
    settings: { handSize, wrongAnswerSkipsPlay },
    players,
    dealerIndex,
    currentPlayerIndex: dealerIndex,
    direction: -1,
    deck: deckLeft,
    discard: [firstCard],
    requiredSuit: null,
    pendingPickup: 0,
    askedIds: [],
    currentQuestions: [],
    activeQuestion: null,
    familyDraft: null,
    familyAnswererIndex: null,
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

    case 'READY_FOR_TURN': {
      const questions = drawQuestions(state.askedIds, 4)
      return { ...state, phase: 'quiz-select', currentQuestions: questions, feedback: null }
    }

    case 'PICK_QUESTION':
      return { ...state, phase: 'quiz-answer', activeQuestion: action.payload }

    case 'PICK_ASK_OWN':
      return { ...state, phase: 'family-compose' }

    case 'ANSWER_QUESTION': {
      const q = state.activeQuestion
      const correct = q.answers[action.payload].correct
      const players = state.players.slice()
      const p = { ...players[state.currentPlayerIndex] }
      if (correct) p.score += 1
      players[state.currentPlayerIndex] = p
      return pushLog(
        {
          ...state,
          players,
          askedIds: [...state.askedIds, q.id],
          feedback: { correct, selected: action.payload },
        },
        `${p.name} ${correct ? 'answered correctly (+1)' : 'answered incorrectly'}.`
      )
    }

    case 'SUBMIT_FAMILY_QUESTION': {
      const answererIndex = nextActiveIndex(state.players, state.currentPlayerIndex, state.direction)
      return {
        ...state,
        phase: 'family-answer',
        familyDraft: action.payload,
        familyAnswererIndex: answererIndex,
      }
    }

    case 'ANSWER_FAMILY_QUESTION': {
      const draft = state.familyDraft
      const correct = draft.correctIndex === action.payload
      const players = state.players.slice()
      const answerer = { ...players[state.familyAnswererIndex] }
      if (correct) answerer.score += 1
      players[state.familyAnswererIndex] = answerer
      return pushLog(
        { ...state, players, feedback: { correct, selected: action.payload, family: true } },
        `${answerer.name} ${correct ? 'answered the family question correctly (+1)' : 'got the family question wrong'}.`
      )
    }

    case 'CONTINUE_TO_CARDS': {
      const wrongSkips = state.settings.wrongAnswerSkipsPlay
      const answeredWrong = state.feedback && state.feedback.correct === false && !state.feedback.family
      if (answeredWrong && wrongSkips) {
        return endTurn(state, { skipAdd: 0, reverseCount: 0 })
      }
      const base = { ...state, feedback: null, selectedCardIds: [], hasDrawnThisTurn: false }
      if (state.pendingPickup > 0) return { ...base, phase: 'pickup-response' }
      return { ...base, phase: 'card-play' }
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

    case 'END_TURN_MANUAL':
      return endTurn(state, { skipAdd: 0, reverseCount: 0 })

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
        players: state.players.map((p) => ({ id: p.id, name: p.name, team: p.team })),
        handSize: state.settings.handSize,
        wrongAnswerSkipsPlay: state.settings.wrongAnswerSkipsPlay,
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
    activeQuestion: null,
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

  return (
    <div className="app-shell">
      <TopBar state={state} />
      <GameBody state={state} dispatch={dispatch} />
    </div>
  )
}

function HomeScreen({ onPlay, onRules, onPowerCards }) {
  return (
    <div className="home-screen">
      <div className="home-orbit orbit-one" />
      <div className="home-orbit orbit-two" />
      <div className="home-card">
        <img className="home-logo" src={`${import.meta.env.BASE_URL}logo.webp`} alt="Family Circle" />
        <p className="home-tag">TOGETHER ALWAYS</p>
        <div className="home-actions">
          <button className="btn primary big home-play" onClick={onPlay}>PLAY A GAME</button>
          <div className="home-secondary">
            <button className="btn secondary" onClick={onRules}>RULES</button>
            <button className="btn secondary" onClick={onPowerCards}>POWER CARDS</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function RulesScreen({ onBack }) {
  return (
    <div className="info-screen">
      <div className="info-card">
        <img className="info-logo" src={`${import.meta.env.BASE_URL}logo.webp`} alt="Family Circle" />
        <h1>Family Circle Rules</h1>
        <p className="info-intro">Core rules currently represented by the supplied testing build.</p>
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
    ['7', 'Reverses direction. The supplied engine also allows a 7 to finish a hand.'],
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

function TopBar({ state }) {
  const player = state.players[state.currentPlayerIndex]
  return (
    <div className="topbar">
      <div className="brand-lockup">
        <img src={`${import.meta.env.BASE_URL}logo.webp`} alt="Family Circle" />
        <div>
          <div className="brand-title">FAMILY CIRCLE</div>
          <div className="brand-subtitle">TOGETHER ALWAYS</div>
        </div>
      </div>
      <div className="stage-status">
        <span className="status-dot" />
        <span>{player ? `${player.name}\u2019s turn \u00b7 ${state.direction === 1 ? 'clockwise' : 'left / counter-clockwise'} \u00b7 dealer: ${state.players[state.dealerIndex]?.name || ''}` : ''}</span>
      </div>
    </div>
  )
}

function GameBody({ state, dispatch }) {
  switch (state.phase) {
    case 'pass-device':
      return <PassDevice state={state} dispatch={dispatch} />
    case 'quiz-select':
      return <QuizSelect state={state} dispatch={dispatch} />
    case 'quiz-answer':
      return <QuizAnswer state={state} dispatch={dispatch} />
    case 'family-compose':
      return <FamilyCompose state={state} dispatch={dispatch} />
    case 'family-answer':
      return <FamilyAnswer state={state} dispatch={dispatch} />
    case 'pickup-response':
      return <TableView state={state} dispatch={dispatch} pickupMode />
    case 'card-play':
      return <TableView state={state} dispatch={dispatch} />
    case 'suit-pick':
      return <SuitPick state={state} dispatch={dispatch} />
    case 'round-over':
      return <RoundOver state={state} dispatch={dispatch} />
    default:
      return null
  }
}

function CenterCard({ children, title, subtitle, footer }) {
  return (
    <div className="game-screen">
      <div className="center-card">
        {title && <h2>{title}</h2>}
        {subtitle && <p className="center-card-sub">{subtitle}</p>}
        <div className="center-card-body">{children}</div>
        {footer && <div className="center-card-footer">{footer}</div>}
      </div>
    </div>
  )
}

function PassDevice({ state, dispatch }) {
  const player = state.players[state.currentPlayerIndex]
  return (
    <CenterCard
      title={`Pass to ${player.name}`}
      subtitle={player.team ? `Team ${player.team}` : 'It\u2019s your turn'}
      footer={
        <button className="btn primary" onClick={() => dispatch({ type: 'READY_FOR_TURN' })}>
          I\u2019m {player.name} \u2014 Start My Turn
        </button>
      }
    >
      <p className="hint">Hand the device to {player.name}. Everyone else, look away!</p>
      <div className="mini-log">
        {state.log.map((l, i) => (
          <div key={i} className="mini-log-line">{l}</div>
        ))}
      </div>
    </CenterCard>
  )
}

function QuizSelect({ state, dispatch }) {
  const player = state.players[state.currentPlayerIndex]
  return (
    <CenterCard title="Choose a question" subtitle={`${player.name}, pick one of the four topics or ask your own`}>
      <div className="question-grid">
        {state.currentQuestions.map((q) => (
          <button key={q.id} className="question-card" onClick={() => dispatch({ type: 'PICK_QUESTION', payload: q })}>
            <span className="question-category">{q.category}</span>
            <span className="question-text">{q.question}</span>
          </button>
        ))}
        <button className="question-card ask-own" onClick={() => dispatch({ type: 'PICK_ASK_OWN' })}>
          <span className="question-category">Family Question</span>
          <span className="question-text">Ask Your Own Question</span>
        </button>
      </div>
    </CenterCard>
  )
}

function QuizAnswer({ state, dispatch }) {
  const q = state.activeQuestion
  const feedback = state.feedback
  const player = state.players[state.currentPlayerIndex]
  return (
    <CenterCard
      title={q.question}
      subtitle={`${player.name} is answering \u00b7 ${q.category}`}
      footer={
        feedback && (
          <button className="btn primary" onClick={() => dispatch({ type: 'CONTINUE_TO_CARDS' })}>
            Continue to card play
          </button>
        )
      }
    >
      <div className="answer-list">
        {q.answers.map((a, i) => {
          let cls = 'answer-option'
          if (feedback) {
            if (a.correct) cls += ' correct'
            else if (i === feedback.selected) cls += ' incorrect'
          }
          return (
            <button
              key={i}
              className={cls}
              disabled={!!feedback}
              onClick={() => dispatch({ type: 'ANSWER_QUESTION', payload: i })}
            >
              {a.text}
            </button>
          )
        })}
      </div>
      {feedback && (
        <p className={`feedback-line ${feedback.correct ? 'good' : 'bad'}`}>
          {feedback.correct ? 'Correct! +1 point.' : 'Not quite \u2014 no point this time.'}
        </p>
      )}
    </CenterCard>
  )
}

function FamilyCompose({ state, dispatch }) {
  const [question, setQuestion] = useState('')
  const [answers, setAnswers] = useState(['', '', ''])
  const [correctIndex, setCorrectIndex] = useState(0)
  const player = state.players[state.currentPlayerIndex]
  const nextIdx = nextActiveIndex(state.players, state.currentPlayerIndex, state.direction)
  const answerer = state.players[nextIdx]
  const valid = question.trim() && answers.every((a) => a.trim())

  return (
    <CenterCard
      title="Ask Your Own Question"
      subtitle={`${player.name} writes it \u2014 ${answerer.name} will answer`}
      footer={
        <button
          className="btn primary"
          disabled={!valid}
          onClick={() => dispatch({ type: 'SUBMIT_FAMILY_QUESTION', payload: { question, answers, correctIndex } })}
        >
          Ask {answerer.name}
        </button>
      }
    >
      <label className="field-label">Your question</label>
      <input className="text-input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Type your question" />
      {answers.map((a, i) => (
        <div key={i} className="answer-row">
          <input
            type="radio"
            name="correct"
            checked={correctIndex === i}
            onChange={() => setCorrectIndex(i)}
            title="Mark as correct answer"
          />
          <input
            className="text-input"
            value={a}
            placeholder={`Answer ${i + 1}${i === 0 ? ' (mark the correct one)' : ''}`}
            onChange={(e) => {
              const next = answers.slice()
              next[i] = e.target.value
              setAnswers(next)
            }}
          />
        </div>
      ))}
    </CenterCard>
  )
}

function FamilyAnswer({ state, dispatch }) {
  const draft = state.familyDraft
  const feedback = state.feedback
  const answerer = state.players[state.familyAnswererIndex]
  return (
    <CenterCard
      title={draft.question}
      subtitle={`${answerer.name} is answering the family question`}
      footer={
        feedback && (
          <button className="btn primary" onClick={() => dispatch({ type: 'CONTINUE_TO_CARDS' })}>
            Continue to card play
          </button>
        )
      }
    >
      <div className="answer-list">
        {draft.answers.map((a, i) => {
          let cls = 'answer-option'
          if (feedback) {
            if (i === draft.correctIndex) cls += ' correct'
            else if (i === feedback.selected) cls += ' incorrect'
          }
          return (
            <button key={i} className={cls} disabled={!!feedback} onClick={() => dispatch({ type: 'ANSWER_FAMILY_QUESTION', payload: i })}>
              {a}
            </button>
          )
        })}
      </div>
      {feedback && (
        <p className={`feedback-line ${feedback.correct ? 'good' : 'bad'}`}>
          {feedback.correct ? `Correct! +1 point for ${answerer.name}.` : 'Not quite \u2014 no point.'}
        </p>
      )}
    </CenterCard>
  )
}

function SuitPick({ state, dispatch }) {
  const player = state.players[state.currentPlayerIndex]
  return (
    <CenterCard title="Choose the next suit" subtitle={`${player.name} played an Ace`}>
      <div className="suit-grid">
        {SUITS.map((s) => (
          <button key={s} className={`suit-btn ${isRed({ suit: s }) ? 'red' : 'black'}`} onClick={() => dispatch({ type: 'CHOOSE_SUIT', payload: s })}>
            <span className="suit-symbol">{SUIT_SYMBOL[s]}</span>
            <span>{SUIT_LABEL[s]}</span>
          </button>
        ))}
      </div>
    </CenterCard>
  )
}

function RoundOver({ state, dispatch }) {
  const winner = state.players.find((p) => p.id === state.winner)
  const ranked = [...state.players].sort((a, b) => b.score - a.score)
  return (
    <CenterCard
      title={`${winner.name} goes out! \ud83c\udf89`}
      subtitle="Round complete"
      footer={
        <button className="btn primary" onClick={() => dispatch({ type: 'PLAY_AGAIN' })}>
          Deal Another Round
        </button>
      }
    >
      <table className="score-table">
        <thead>
          <tr><th>Player</th><th>Cards left</th><th>Quiz score</th></tr>
        </thead>
        <tbody>
          {ranked.map((p) => (
            <tr key={p.id} className={p.id === winner.id ? 'winner-row' : ''}>
              <td>{p.name}{p.team ? ` (Team ${p.team})` : ''}</td>
              <td>{p.id === winner.id ? 0 : p.hand.length}</td>
              <td>{p.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">
        House rule note: only {winner.name} went out first is tracked as the round winner. Whether remaining
        hand sizes should affect final scoring wasn\u2019t locked in the rule sheet \u2014 turn on \u201cScore remaining
        cards\u201d in setup next time if your family wants that.
      </p>
    </CenterCard>
  )
}

// ---------- table / card play ----------

function TableView({ state, dispatch, pickupMode }) {
  const player = state.players[state.currentPlayerIndex]
  const topCard = state.discard[state.discard.length - 1]
  const feedback = state.feedback
  const canPlay = state.selectedCardIds.length > 0

  const seatOrder = useMemo(() => {
    const n = state.players.length
    return state.players.map((p, i) => ({ ...p, angle: (360 / n) * i }))
  }, [state.players])

  return (
    <div className="game-screen">
      <div className="table-felt">
        <div className="table-surface" aria-hidden="true" />
        <div className="seat-ring">
          {seatOrder.map((p, i) => (
            <div
              key={p.id}
              className={`seat ${i === state.currentPlayerIndex ? 'seat-active' : ''} ${p.out ? 'seat-out' : ''}`}
              style={{ '--angle': `${p.angle}deg` }}
            >
              <div className="seat-avatar" style={{ borderColor: TEAM_COLORS[p.team || 'none'] }}>
                {p.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="seat-label">{p.name}</div>
              <div className="seat-count">{p.out ? 'OUT' : `${p.hand.length} cards`}</div>
            </div>
          ))}
        </div>

        <div className="pile-area">
          <div className="pile draw-pile" title={`${state.deck.length} left`}>
            <div className="mini-card-back">FC</div>
            <span className="pile-count">{state.deck.length}</span>
          </div>
          <div className="pile discard-pile">
            <PlayingCard card={topCard} />
            {state.requiredSuit && <div className="required-suit-badge">{SUIT_SYMBOL[state.requiredSuit]} required</div>}
          </div>
        </div>

        {state.pendingPickup > 0 && (
          <div className="pickup-banner">Pending pickup: {state.pendingPickup} cards</div>
        )}
      </div>

      <div className="your-hand-area">
        <div className="hand-title">
          {player.name}\u2019s hand {pickupMode && <span>\u2014 respond to the pickup</span>}
        </div>
        {feedback && feedback.error && <p className="feedback-line bad">{feedback.error}</p>}
        <div className="hand-row">
          {player.hand.map((c) => {
            const eligible = !pickupMode || canCounterPickup(c) || isRedJack(c)
            return (
              <PlayingCard
                key={c.id}
                card={c}
                dim={!eligible}
                selected={state.selectedCardIds.includes(c.id)}
                order={state.selectedCardIds.indexOf(c.id)}
                onClick={eligible ? () => dispatch({ type: 'TOGGLE_CARD', payload: c.id }) : undefined}
              />
            )
          })}
        </div>
        <div className="control-actions">
          {pickupMode ? (
            <>
              <button className="btn" disabled={!canPlay} onClick={() => dispatch({ type: 'PLAY_PICKUP_RESPONSE' })}>
                Play Selected
              </button>
              <button className="btn secondary" onClick={() => dispatch({ type: 'CLEAR_SELECTION' })}>Clear</button>
              <button className="btn primary" onClick={() => dispatch({ type: 'DRAW_PICKUP' })}>
                Pick Up {state.pendingPickup} Cards
              </button>
            </>
          ) : (
            <>
              <button className="btn primary" disabled={!canPlay} onClick={() => dispatch({ type: 'PLAY_SELECTED' })}>
                Play Selected
              </button>
              <button className="btn secondary" onClick={() => dispatch({ type: 'CLEAR_SELECTION' })}>Clear</button>
              <button className="btn" disabled={state.hasDrawnThisTurn} onClick={() => dispatch({ type: 'DRAW_ONE' })}>
                Draw Card
              </button>
              <button className="btn secondary" onClick={() => dispatch({ type: 'END_TURN_MANUAL' })}>End Turn</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function PlayingCard({ card, selected, order, onClick, dim }) {
  if (!card) return <div className="card face-down" />
  const red = isRed(card)
  return (
    <button
      className={`card ${red ? 'red' : 'black'} ${selected ? 'selected' : ''} ${dim ? 'dim' : ''}`}
      onClick={onClick}
      disabled={!onClick}
    >
      {selected && order > -1 && <span className="order-badge">{order + 1}</span>}
      <span className="card-rank top">{card.rank}</span>
      <span className="card-suit-big">{SUIT_SYMBOL[card.suit]}</span>
      <span className="card-rank bottom">{card.rank}</span>
    </button>
  )
}

// ---------- setup ----------

function SetupScreen({ onBack, onStart }) {
  const [count, setCount] = useState(4)
  const [names, setNames] = useState(['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5', 'Player 6', 'Player 7'])
  const [teamMode, setTeamMode] = useState('none') // none | 2v2 | 3v3
  const [handSize, setHandSize] = useState(7)
  const [wrongAnswerSkipsPlay, setWrongAnswerSkipsPlay] = useState(true)

  const teamOptionsDisabled = {
    '2v2': count !== 4,
    '3v3': count !== 6,
  }

  function buildTeams(n, mode) {
    if (mode === 'none') return Array(n).fill(null)
    const perTeam = mode === '2v2' ? 2 : 3
    const teams = []
    for (let i = 0; i < n; i++) teams.push(i % 2 === 0 ? 'A' : 'B')
    return teams
  }

  function handleStart() {
    const teams = buildTeams(count, teamMode)
    const players = Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      name: names[i] || `Player ${i + 1}`,
      team: teams[i],
    }))
    onStart({ players, handSize, wrongAnswerSkipsPlay })
  }

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <img className="setup-logo" src={`${import.meta.env.BASE_URL}logo.webp`} alt="Family Circle" />
        <h1>Family Circle</h1>
        <p className="setup-tag">Together Always \u2014 set up tonight\u2019s round</p>

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

        <label className="field-label">Format</label>
        <div className="format-row">
          <button className={`btn ${teamMode === 'none' ? 'primary' : 'secondary'}`} onClick={() => setTeamMode('none')}>
            Individual
          </button>
          <button
            className={`btn ${teamMode === '2v2' ? 'primary' : 'secondary'}`}
            disabled={teamOptionsDisabled['2v2']}
            title={teamOptionsDisabled['2v2'] ? 'Needs exactly 4 players' : ''}
            onClick={() => setTeamMode('2v2')}
          >
            Teams 2v2
          </button>
          <button
            className={`btn ${teamMode === '3v3' ? 'primary' : 'secondary'}`}
            disabled={teamOptionsDisabled['3v3']}
            title={teamOptionsDisabled['3v3'] ? 'Needs exactly 6 players' : ''}
            onClick={() => setTeamMode('3v3')}
          >
            Teams 3v3
          </button>
          <button className="btn secondary" disabled title="Needs 8 seats \u2014 the shared table currently supports 7. Flagged as an open question, see README.">
            Teams 4v4
          </button>
        </div>

        <details className="settings-details">
          <summary>House-rule settings (not locked by the rule sheet \u2014 adjust freely)</summary>
          <label className="field-label">Starting hand size ({handSize})</label>
          <input type="range" min="4" max="10" value={handSize} onChange={(e) => setHandSize(Number(e.target.value))} />

          <label className="check-row">
            <input type="checkbox" checked={wrongAnswerSkipsPlay} onChange={(e) => setWrongAnswerSkipsPlay(e.target.checked)} />
            A wrong quiz answer skips that player\u2019s card play this turn
          </label>

        </details>

        <button className="btn primary big" onClick={handleStart}>START GAME</button>
      </div>
    </div>
  )
}