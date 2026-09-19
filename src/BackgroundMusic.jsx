import { useEffect, useRef, useState } from 'react'

const TRACKS = [
  '/FCcardgame/audio/Soft Marimba Groove.mp3',
  '/FCcardgame/audio/Soft Marimba Groove (1).mp3',
  '/FCcardgame/audio/Soft Marimba Groove (2).mp3',
  '/FCcardgame/audio/Soft Marimba Groove (3).mp3',
]

export default function BackgroundMusic({ enabled = true }) {
  const audioRef = useRef(null)
  const indexRef = useRef(0)
  const [muted, setMuted] = useState(false)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (!enabled) return undefined
    const audio = audioRef.current
    if (!audio) return undefined

    const playTrack = async (index) => {
      indexRef.current = index
      audio.src = TRACKS[index]
      audio.volume = 0.22
      audio.muted = muted
      audio.load()
      try {
        await audio.play()
        setBlocked(false)
      } catch {
        setBlocked(true)
      }
    }

    const handleEnded = () => {
      playTrack((indexRef.current + 1) % TRACKS.length)
    }

    audio.addEventListener('ended', handleEnded)
    playTrack(indexRef.current)

    return () => {
      audio.removeEventListener('ended', handleEnded)
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
  }, [enabled])

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted
  }, [muted])

  const resume = async () => {
    const audio = audioRef.current
    if (!audio) return
    try {
      await audio.play()
      setBlocked(false)
    } catch {
      setBlocked(true)
    }
  }

  if (!enabled) return null

  return (
    <>
      <audio ref={audioRef} preload="auto" aria-hidden="true" />
      <div className="music-control">
        {blocked && (
          <button className="music-control-button" onClick={resume}>
            ▶ MUSIC
          </button>
        )}
        {!blocked && (
          <button className="music-control-button" onClick={() => setMuted((value) => !value)}>
            {muted ? '🔇 MUSIC' : '♫ MUSIC'}
          </button>
        )}
      </div>
    </>
  )
}
