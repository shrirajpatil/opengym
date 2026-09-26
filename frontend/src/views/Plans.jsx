// Read-only plan browser: Plans -> a plan -> a day -> its exercises -> the exercise's own
// detail sheet (GIF + still + instructions, the same one Library/Muscles already use). Never
// touches S.routines/S.week — loading a plan onto your own calendar is still Plan's job
// (sheets.jsx's starterPlanSheet); this only lets you look at what a plan actually contains
// before you commit to it, or reference it once you're mid-week.
import { useParams, useNavigate } from 'react-router-dom'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { DAYN } from '../lib/format.js'
import { starterPlanOptions, starterPlanRows } from '../lib/starter.js'
import { exOr } from '../lib/exercises.js'
import { exerciseDetailSheet } from '../sheets.jsx'
import { Thumb } from '../components/Media.jsx'
import Icon from '../components/Icon.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'

// Same names as the starter-plan chooser (sheets.jsx's PLAN_COPY) — kept here too because
// check-source-strings.mjs only finds t() calls written as string literals, not ones built
// from a shared table across two files.
const PLAN_NAME = {
  ppl: () => t('Push / Pull / Legs'),
  'upper-lower': () => t('Upper / Lower'),
  'full-body': () => t('Full Body'),
  '5x5': () => t('5×5'),
  'ppl2-beginner': () => t('Beginner PPL ×2')
}

function Header({ back, title, sub }) {
  return <div className="hdr">
    <button className="iconbtn" onClick={back} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
    <div style={{ flex: 1, marginLeft: 12 }}><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>
  </div>
}

function PlanList() {
  const nav = useNavigate()
  return <>
    <div className="hdr"><h1>{t('Plans')}</h1></div>
    <div className="sub" style={{ marginBottom: 12 }}>{t('Browse a full training plan before you load it, or look one up mid-week.')}</div>
    <div className="list">
      {starterPlanOptions().map(({ id, days }) => (
        <div key={id} className="item" {...tappable(() => nav('/plans/' + id))}>
          <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="sparkles" /></span>
          <div className="grow"><div className="tt">{PLAN_NAME[id]()}</div><div className="ss">{t('{0} days per week', days)}</div></div>
          <Icon name="chevronRight" className="chev" />
        </div>
      ))}
    </div>
  </>
}

function PlanDays() {
  const { planId } = useParams()
  const nav = useNavigate()
  const rows = starterPlanRows(planId)
  if (!rows) return <PlanList />
  return <>
    <Header back={() => nav('/plans')} title={PLAN_NAME[planId]()} sub={t('{0} days per week', rows.length)} />
    <div className="list">
      {rows.map(({ day, name, emoji }) => (
        <div key={day} className="item" {...tappable(() => nav('/plans/' + planId + '/' + day))}>
          <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name={emoji} /></span>
          <div className="grow"><div className="tt">{t(DAYN[day])}</div><div className="ss">{name}</div></div>
          <Icon name="chevronRight" className="chev" />
        </div>
      ))}
    </div>
  </>
}

function PlanDay() {
  const { planId, day } = useParams()
  const nav = useNavigate()
  const rows = starterPlanRows(planId)
  const row = rows?.find(r => String(r.day) === day)
  if (!rows || !row) return <PlanList />
  return <>
    <Header back={() => nav('/plans/' + planId)} title={row.name} sub={t(DAYN[row.day])} />
    <div className="list">
      {row.list.map(([id, sets, reps], i) => {
        const ex = exOr(id)
        return (
          <div key={i} className="item" {...tappable(() => exerciseDetailSheet(ex))}>
            <Thumb ex={ex} />
            <div className="grow"><div className="tt capitalize">{exerciseNameFor(ex)}</div><div className="ss">{t('{0} sets × {1} reps', sets, reps)}</div></div>
            <Icon name="chevronRight" className="chev" />
          </div>
        )
      })}
    </div>
  </>
}

export default function Plans() {
  const { planId, day } = useParams()
  if (planId && day != null) return <PlanDay />
  if (planId) return <PlanDays />
  return <PlanList />
}
