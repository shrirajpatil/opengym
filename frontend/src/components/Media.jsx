import { useState } from 'react'
import { imgSrc, gifSrc } from '../lib/exercises.js'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Big autoplaying animation; tap toggles to the still frame. `compact` shrinks it (superset cards).
// Custom exercises have no media — the animation stays blank by design (issue #11).
// `minimizable` (workout view) adds a persistent minimize/expand control so the animation stops
// eating the screen; the chosen size is saved to settings and carries across exercises and
// future workouts (issue #12). Settings can also turn workout media off entirely
// (gifSize 'off') — then nothing renders here and the exercise card closes up, exactly like
// a custom exercise without media. Any other/legacy value behaves as 'full'.
// `showStill` renders the exercise's own static frame underneath the animation, always visible
// rather than tap-to-toggle — the Plans tab's exercise view wants both at once (the animation to
// see the movement, a still to actually study the end position), not a switch between them.
export default function Media({ ex, id, compact, minimizable, showStill }) {
  const [playing, setPlaying] = useState(true)
  // 'gif' → the animation failed, the still is showing; 'all' → the still failed too. Media is
  // fetched from wherever the build points (a mount, a CDN): a dropped connection, an expired
  // session on a gated instance or a CDN hiccup used to leave the browser's broken-image glyph
  // on a white block. Now the still stands in for the animation, a neutral tile stands in for
  // both, and a tap tries again — no text, so nothing new to translate.
  const [failed, setFailed] = useState(null)
  // Tracks whether the current src has actually painted yet. A CDN-backed build (VITE_GIF_BASE
  // pointed off-origin) can take a real, visible moment, so a loading exercise gets the same
  // neutral tile as a broken one rather than a blank/white rectangle until the network resolves.
  // Keyed by src so switching still/animation (the tap-to-pause toggle) re-arms it correctly.
  const [loadedSrc, setLoadedSrc] = useState(null)
  const gifSize = useStore(s => s.S.gifSize)
  const update = useStore(s => s.update)
  if (!ex.gif) return null
  if (minimizable && gifSize === 'off') return null
  const mini = minimizable && gifSize === 'mini'
  const toggleSize = e => { e.stopPropagation(); update(s => { s.gifSize = mini ? 'full' : 'mini' }) }
  const showGif = playing && failed == null
  const src = showGif ? gifSrc(ex) : imgSrc(ex)
  const loading = failed !== 'all' && loadedSrc !== src
  const onError = () => setFailed(showGif ? 'gif' : 'all')
  const onLoad = () => setLoadedSrc(src)
  const onTap = () => {
    if (failed) { setFailed(null); setPlaying(true); return }
    setPlaying(p => !p)
  }
  return (
    <>
    <div className={'exmedia' + (compact ? ' compact' : '') + (mini ? ' mini' : '') + (failed === 'all' ? ' broken' : '') + (loading ? ' wk-media-loading' : '')} id={id} onClick={onTap}>
      {failed === 'all'
        ? <div className="exmedia-x"><Icon name="dumbbell" /></div>
        : <img decoding="async" draggable={false} src={src} alt={exerciseNameFor(ex)} onError={onError} onLoad={onLoad} />}
      {loading && <div className="wk-media-skel" aria-hidden="true" />}
      {minimizable && (
        <button className="giftoggle" onClick={toggleSize}>
          <Icon name={mini ? 'expand' : 'minimize'} />{mini ? t('Expand') : t('Minimize')}
        </button>
      )}
      {!mini && !failed && (
        <span className="gifhint">
          <Icon name={playing ? 'pause' : 'play'} />{playing ? t('tap to pause') : t('tap to play')}
        </span>
      )}
    </div>
    {showStill && ex.img && failed !== 'all' && (
      <div className="exmedia-still">
        <img decoding="async" draggable={false} loading="lazy" src={imgSrc(ex)} alt={exerciseNameFor(ex)} />
        <span className="exmedia-still-label">{t('End position')}</span>
      </div>
    )}
    </>
  )
}

export function Thumb({ ex }) {
  const [loaded, setLoaded] = useState(false)
  if (!ex.img) return <div className="thumb thumb-x"><Icon name="dumbbell" /></div>
  return (
    <span className={'wk-thumb-wrap' + (loaded ? '' : ' wk-media-loading')}>
      <img className="thumb" loading="lazy" decoding="async" draggable={false} src={imgSrc(ex)} alt="" onLoad={() => setLoaded(true)} />
      {!loaded && <span className="wk-media-skel wk-thumb-skel" aria-hidden="true" />}
    </span>
  )
}
