import { useEffect, useRef, useState } from 'react'

const TRACKS = [
  new URL('./audio/Soft Marimba Groove.mp3', import.meta.url).href,
  new URL('./audio/Soft Marimba Groove (1).mp3', import.meta.url).href,
  new URL('./audio/Soft Marimba Groove (2).mp3', import.meta.url).href,
  new URL('./audio/Soft Marimba Groove (3).mp3', import.meta.url).href,
]

export default function BackgroundMusic({ enabled = true }) {
  const audioRef = useRef(null)
  const indexRef = useRef(0)
  const [muted, setMuted] = useState(false)
  const [blocked, setBlocked] = useState(true)

  useEffect(() => {
    if (!enabled) return undefined
    const audio = audioRef.current
    if (!audio) return undefined

    const playTrack = async (index) => {
      indexRef.current = index
      audio.src = TRACKS[index]
      audio.volume = 0.22
      audio.muted = false
      audio.load()
      try {
        await audio.play()
        setMuted(false)
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
      if (!audio.src) {
        audio.src = TRACKS[indexRef.current]
        audio.volume = 0.22
        audio.load()
      }
      await audio.play()
      setBlocked(false)
      setMuted(false)
    } catch {
      setBlocked(true)
    }
  }

  const toggleMute = () => {
    setMuted((value) => !value)
  }

  if (!enabled) return null

  return (
    <>
      <audio ref={audioRef} preload="auto" aria-hidden="true" />
      <div className="music-control">
        {blocked ? (
          <button
            className="music-control-button"
            onClick={resume}
            aria-label="Play background music"
          >
            ▶ MUSIC
          </button>
        ) : (
          <button
            className="music-control-button"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute background music' : 'Mute background music'}
            aria-pressed={muted}
          >
            {muted ? '🔇 MUSIC' : '♫ MUSIC'}
          </button>
        )}
      </div>
    </>
  )
}
