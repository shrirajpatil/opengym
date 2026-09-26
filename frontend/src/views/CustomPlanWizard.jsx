// Build your own plan from scratch: name it, choose weekday or rolling-cycle scheduling, then
// pick exercises for each day. Ends the same way loading a starter plan does — routines pushed,
// a schedule written — so the result is an ordinary plan a user can edit afterwards exactly like
// any other, not a special "custom plan" type that needs its own maintenance surface forever.
import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { uid, DAYN, todayISO } from '../lib/format.js'
import { exOr } from '../lib/exercises.js'
import { defaultConfig } from '../lib/history.js'
import { exercisePicker, confirmSheet } from '../sheets.jsx'
import { Thumb } from '../components/Media.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Segmented, Stepper, TextField } from '../components/ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'

// The wizard's own working state is a plain array either way — [{ label, ex: [...] }] — weekday
// mode just fixes it at exactly 7 entries labeled Sun..Sat instead of a user-picked N labeled
// "Day 1..N". One shape, one rendering path for the exercise-editing step.
const WEEKDAY_LABELS = DAYN.map((_, i) => i) // 0..6, matched against t(DAYN[i]) at render time

export default function CustomPlanWizard() {
  const nav = useNavigate()
  const update = useStore(s => s.update)
  const S = useStore(s => s.S)
  // Forking an existing plan (Plans.jsx's "Edit as custom") hands its exercises in via router
  // state rather than a URL param — this is working data for one navigation, not a bookmarkable
  // page. The fork itself never touches the source plan: it is read once here, at mount, to seed
  // the wizard's own local state, exactly as if a user had picked every exercise by hand.
  const fork = useLocation().state?.fork ?? null
  const [step, setStep] = useState(fork ? 1 : 0) // 0 name+mode, 1 per-day exercises
  const [name, setName] = useState(fork?.name || '')
  const [mode, setMode] = useState(fork?.mode || 'weekday') // 'weekday' | 'cycle'
  const [n, setN] = useState(fork?.mode === 'cycle' ? fork.days.length : 6)
  const [days, setDays] = useState(() => fork ? fork.days : WEEKDAY_LABELS.map(() => []))

  const dayCount = mode === 'weekday' ? 7 : n
  const dayLabel = i => mode === 'weekday' ? t(DAYN[i]) : t('Day {0}', i + 1)
  const ensureDays = count => setDays(cur => {
    if (cur.length === count) return cur
    const next = cur.slice(0, count)
    while (next.length < count) next.push([])
    return next
  })
  const setCount = v => { setN(v); ensureDays(v) }

  const addExercise = dayIndex => exercisePicker(ex => {
    setDays(cur => cur.map((list, i) => i === dayIndex ? [...list, { id: ex.id, ...defaultConfig(ex.id) }] : list))
  })
  const removeExercise = (dayIndex, exIndex) => setDays(cur => cur.map((list, i) => i === dayIndex ? list.filter((_, j) => j !== exIndex) : list))

  const canFinish = name.trim() && days.slice(0, dayCount).some(list => list.length)

  const finish = () => {
    const trimmedName = name.trim() || t('Custom plan')
    const activeDays = (mode === 'weekday' ? WEEKDAY_LABELS : days.map((_, i) => i)).slice(0, dayCount)
    const sourcePlanId = 'custom-' + uid()
    const routines = activeDays
      .map((_, i) => ({ i, ex: days[i] || [] }))
      .filter(({ ex }) => ex.length)
      .map(({ i, ex }) => ({
        id: uid(),
        name: dayCount > 1 ? `${trimmedName} — ${dayLabel(i)}` : trimmedName,
        emoji: DEFAULT_GLYPH,
        ex,
        sourcePlanId,
        dayIndex: i
      }))
    const load = () => {
      update(s => {
        s.routines.push(...routines)
        if (mode === 'weekday') {
          routines.forEach(r => { s.week[r.dayIndex] = [r.id] })
        } else {
          s.cyclePlan = { active: true, routineIds: routines.map(r => r.id), startDate: todayISO(), sourcePlanId }
        }
      })
      nav('/plan')
    }
    // Same "existing routines are kept" framing the starter-plan chooser already uses — only
    // asked when going custom-cycle would leave an existing weekly plan looking abandoned,
    // never blocking, since nothing is actually deleted either way.
    if (mode === 'cycle' && Object.keys(S.week).length) {
      confirmSheet({
        title: t('Switch to a rolling cycle?'),
        message: t('Your weekly plan is kept, just not used while the cycle plan is active. You can switch back any time.'),
        confirmText: t('Load plan'),
        onConfirm: load
      })
    } else load()
  }

  if (step === 0) return <>
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/plans')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 12 }}><h1>{t('Custom plan')}</h1></div>
    </div>
    <div className="small muted" style={{ marginBottom: 6 }}>{t('Name')}</div>
    <TextField value={name} onChange={e => setName(e.target.value)} placeholder={t('My plan')} maxLength={40} style={{ marginBottom: 16 }} />
    <div className="small muted" style={{ marginBottom: 6 }}>{t('Schedule')}</div>
    <Segmented value={mode} onChange={setMode} options={[{ value: 'weekday', label: t('Weekday') }, { value: 'cycle', label: t('Rolling cycle') }]} />
    {mode === 'weekday'
      ? <div className="dim small" style={{ marginTop: 8 }}>{t('Pick which days of the week to train — the familiar weekly grid.')}</div>
      : <>
        <div className="dim small" style={{ marginTop: 8, marginBottom: 10 }}>{t('Repeats every {0} days from whenever you start it, regardless of the weekday.', n)}</div>
        <Stepper value={n} step={1} decimal={false} onChange={v => setCount(Math.max(2, Math.min(14, Math.round(v))))} label={t('Days in the cycle')} />
      </>}
    <div style={{ height: 16 }} />
    <Button variant="primary" onClick={() => { ensureDays(dayCount); setStep(1) }} disabled={!name.trim()}>{t('Next')}</Button>
  </>

  return <>
    <div className="hdr">
      <button className="iconbtn" onClick={() => setStep(0)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 12 }}><h1>{name.trim() || t('Custom plan')}</h1><div className="sub">{t('Add exercises to each day')}</div></div>
    </div>
    <div className="list" style={{ display: 'flex', flexDirection: 'column', marginBottom: 16 }}>
      {Array.from({ length: dayCount }, (_, i) => i).map(i => (
        <div key={i} className="item" style={{ display: 'block', padding: '10px 14px' }}>
          <div className="row between" style={{ marginBottom: 6 }}>
            <div className="tt">{dayLabel(i)}</div>
            <div className="small dim">{t('{0} exercises', (days[i] || []).length)}</div>
          </div>
          {(days[i] || []).map((cfg, j) => {
            const ex = exOr(cfg.id)
            return <div key={j} className="row" style={{ gap: 8, padding: '4px 0 4px 8px' }}>
              <Thumb ex={ex} />
              <div className="grow" style={{ minWidth: 0 }}><div className="tt capitalize" style={{ fontSize: 14 }}>{exerciseNameFor(ex)}</div></div>
              <button className="iconbtn sm" aria-label={t('Remove')} onClick={() => removeExercise(i, j)}><Icon name="xmark" /></button>
            </div>
          })}
          <button className="btn ghost sm" style={{ marginTop: 4, marginLeft: 8 }} onClick={() => addExercise(i)}>
            <Icon name="plus" /> {t('Add exercise')}
          </button>
        </div>
      ))}
    </div>
    <Button variant="primary" onClick={finish} disabled={!canFinish}>{t('Save plan')}</Button>
  </>
}
