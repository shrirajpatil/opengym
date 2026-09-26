import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { DAYN, weekOrder, weekStartOf, uid, exCount, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { dayAssignSheet, dayAddRoutineSheet, starterPlanSheet, planToolsSheet, cycleResyncSheet } from '../sheets.jsx'
import { cycleDayIndex } from '../lib/history.js'
import Icon from '../components/Icon.jsx'
import { Button, Switch } from '../components/ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { coachAvailable } from '../lib/coach.js'

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const config = useStore(s => s.config)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const user = useStore(s => s.user)

  /* The Coach's only entry point in the app. Its screens have existed since the UI landed and
     nothing linked to them, so the feature was reachable only by typing the URL — enabled,
     configured, and invisible. The same predicate every other Coach surface uses gates it, so
     an instance without the feature sees exactly the Plan screen it saw before. */
  const showCoach = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }

  // Pull one routine off a weekday; drop the key when the day empties (never store []).
  const removeFromDay = (d, rid) => update(s => {
    const next = [].concat(s.week[d] || []).filter(id => id !== rid)
    if (next.length) s.week[d] = next; else delete s.week[d]
  })

  return <>
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
    </div>
    {/* Always visible, not just when Routines is empty — browsing a starter plan's own
        structure (day by day, exercise by exercise, GIF included) without loading it onto the
        week is something worth reaching even once you already have routines of your own. */}
    <button className="coach-cta" onClick={() => nav('/plans')} style={{ marginBottom: 14 }}>
      <span className="coach-cta-av"><Icon name="clipboard" /></span>
      <span className="coach-cta-t">
        <b>{t('Starter plans')}</b>
        <span>{t('Browse a full training plan before you load it')}</span>
      </span>
      <Icon name="chevronRight" className="coach-cta-chev" />
    </button>
    {showCoach && <button className="coach-cta" onClick={() => nav('/coach')}>
      <span className="coach-cta-av"><Icon name="sparkles" /></span>
      <span className="coach-cta-t">
        <b>{t('Coach')}</b>
        <span>{t('Plan design and reviews, from your own training')}</span>
      </span>
      <Icon name="chevronRight" className="coach-cta-chev" />
    </button>}

    {/* Shown once a cycle plan exists at all, active or not — a stopped one still gets its own
        row here, the same way S.reminder keeps showing in Settings once it exists but is off,
        so turning it back on doesn't feel like reaching for a feature that vanished. */}
    {S.cyclePlan && <div className="cols" style={{ marginBottom: 4 }}><div>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Cycle plan')}</h4>
        <Switch checked={!!S.cyclePlan.active} onChange={v => update(s => { s.cyclePlan.active = v })} />
      </div>
      <div className="list" style={{ display: 'flex', flexDirection: 'column', marginBottom: 8 }}>
        {S.cyclePlan.routineIds.map((id, i) => {
          const r = S.routines.find(x => x.id === id)
          const isToday = S.cyclePlan.active && cycleDayIndex(S.cyclePlan, todayISO()) === i
          return <div key={i} className="item" style={{ padding: '10px 14px' }}>
            <span className="lrow-i" style={{ width: 26, height: 26, fontSize: 14 }}><Icon name={r ? glyphOf(r.emoji) : 'moon'} /></span>
            <div className="grow"><div className="tt" style={{ fontSize: 14 }}>{t('Day {0}', i + 1)}</div><div className="ss">{r ? r.name : t('Rest')}</div></div>
            {isToday && <span className="tag acc">{t('Today')}</span>}
          </div>
        })}
      </div>
      <Button size="sm" variant="secondary" icon="reset" onClick={cycleResyncSheet}>{t('Resync')}</Button>
    </div></div>}

    <div className="cols"><div>
      <div className="row between" style={{ marginBottom: 4 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Week schedule')}</h4>
      </div>
      {S.cyclePlan?.active && <div className="dim small" style={{ marginBottom: 8 }}>{t('Not used while your cycle plan is active.')}</div>}
      <div className="list" style={{ display: 'flex', flexDirection: 'column' }}>
        {weekOrder(weekStartOf(S)).map(d => {
          const dayRoutines = [].concat(S.week[d] || []).map(id => S.routines.find(x => x.id === id)).filter(Boolean)
          // An empty day stays one tappable row → pick its first routine (today's behaviour).
          if (!dayRoutines.length) return <div key={d} className="item" {...tappable(() => dayAssignSheet(d))}>
            <div className="grow"><div className="tt">{t(DAYN[d])}</div></div>
            <span className="tag">{t('Rest')}</span>
            <Icon name="chevronRight" className="chev" /></div>
          // A populated day: always-visible routine sub-rows + inline ✕, then ＋ Add routine.
          return <div key={d} className="item" style={{ display: 'block', padding: '10px 14px' }}>
            <div className="row between" style={{ marginBottom: 6 }}>
              <div className="tt">{t(DAYN[d])}</div>
              <div className="small dim">{t('{0} routines', dayRoutines.length)}</div>
            </div>
            {dayRoutines.map(r => <div key={r.id} className="row" style={{ gap: 8, padding: '4px 0 4px 8px' }}>
              <span className="lrow-i" style={{ width: 26, height: 26, fontSize: 14 }}><Icon name={glyphOf(r.emoji)} /></span>
              <div className="grow" style={{ minWidth: 0 }}><div className="tt" style={{ fontSize: 14 }}>{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
              <button className="iconbtn sm" aria-label={t('Remove')} onClick={() => removeFromDay(d, r.id)}><Icon name="xmark" /></button>
            </div>)}
            <button className="btn ghost sm" style={{ marginTop: 4, marginLeft: 8 }} onClick={() => dayAddRoutineSheet(d)}>
              <Icon name="plus" /> {t('Add routine')}
            </button>
          </div>
        })}
      </div>
    </div><div>
      <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Routines')}</h4>
        <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button>
      </div>
      {S.routines.length ? <div className="list">{S.routines.map(r => <div key={r.id} className="item" {...tappable(() => nav('/plan/r/' + r.id))}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <Icon name="chevronRight" className="chev" /></div>)}</div> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Create one or load the starter plan.')}</div>
        <Button icon="sparkles" onClick={starterPlanSheet}>{t('Load starter plan')}</Button>
      </>}
    </div></div>
  </>
}
