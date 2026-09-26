// Read-only plan browser: Plans -> a plan -> a day -> its exercises -> the exercise's own
// detail sheet (GIF + still + instructions, the same one Library/Muscles already use). Never
// touches S.routines/S.week — loading a plan onto your own calendar is still Plan's job
// (sheets.jsx's starterPlanSheet); this only lets you look at what a plan actually contains
// before you commit to it, or reference it once you're mid-week.
import { useParams, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { DAYN } from '../lib/format.js'
import { starterPlanOptions, starterPlanRows, starterPlanDays } from '../lib/starter.js'
import { exOr } from '../lib/exercises.js'
import { exerciseDetailSheet, chooseStarterPlan } from '../sheets.jsx'
import { defaultConfig } from '../lib/history.js'
import { Thumb } from '../components/Media.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'

// A starter plan's static [id, sets, reps] rows, converted into the shape the custom-plan
// wizard's own local state uses ({ id, ...defaultConfig(id) }, with sets/reps overridden from
// the template) — so "Edit as custom" forks by re-deriving the same exercise configs a user
// would get picking them by hand, not by copying some other internal shape the wizard doesn't
// already understand.
function forkDaysFromRows(rows) {
  return rows.map(({ list }) => list.map(([id, sets, reps]) => ({ id, ...defaultConfig(id), sets, reps })))
}

// A starter plan is "Active" when either every weekday it claims currently holds a routine
// stamped with its id (weekday mode — checking BOTH the day and the stamp, since reassigning
// that weekday away from the plan should clear the badge even though the old routine object
// still carries the marker), or the cycle plan's own source matches (cycle mode). Name matching
// was deliberately not used — renaming "Push A" to "Chest Day" must not silently break this.
function isPlanActive(S, planId) {
  if (S.cyclePlan?.active && S.cyclePlan.sourcePlanId === planId) return true
  const days = starterPlanDays(planId)
  if (!days) return false
  return days.every(d => [].concat(S.week[d] || []).some(id => S.routines.find(r => r.id === id)?.sourcePlanId === planId))
}

// Same names as the starter-plan chooser (sheets.jsx's PLAN_COPY) — kept here too because
// check-source-strings.mjs only finds t() calls written as string literals, not ones built
// from a shared table across two files.
export const PLAN_NAME = {
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

// The plan-selection list itself — the main content of both the Plan screen (embedded, no
// header of its own) and this file's own /plans route (with a Header, for anyone who lands on
// the URL directly). One list, one place that knows what "Selected" means, so a rename or a new
// starter plan added to lib/starter.js only has to be reflected here once.
export function PlanSelectList() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  return <div className="list">
    {starterPlanOptions().map(({ id, days }) => {
      const selected = isPlanActive(S, id)
      return <div key={id} className="item" {...tappable(() => chooseStarterPlan(id, PLAN_NAME[id]()))}>
        <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="sparkles" /></span>
        <div className="grow"><div className="tt">{PLAN_NAME[id]()}</div><div className="ss">{selected ? t('Selected') : t('{0} days per week', days)}</div></div>
        <button className="iconbtn sm" aria-label={t('View days')} onClick={e => { e.stopPropagation(); nav('/plans/' + id) }}><Icon name="info" /></button>
      </div>
    })}
    <div className="item" {...tappable(() => nav('/plans/custom/new'))}>
      <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="plus" /></span>
      <div className="grow"><div className="tt">{t('Custom')}</div><div className="ss">{t('Build your own plan, weekday or rolling cycle')}</div></div>
      <Icon name="chevronRight" className="chev" />
    </div>
  </div>
}

function PlanList() {
  const nav = useNavigate()
  // Reached directly at /plans (a bookmark, a deep link) — the Plan screen itself embeds
  // PlanSelectList without this header, since it isn't a pushed screen there.
  return <>
    <Header back={() => nav('/plan')} title={t('Plans')} />
    <div className="sub" style={{ marginBottom: 12 }}>{t('Tap a plan to apply it to your week — the info icon looks at its days first.')}</div>
    <PlanSelectList />
  </>
}

function PlanDays() {
  const { planId } = useParams()
  const nav = useNavigate()
  const rows = starterPlanRows(planId)
  if (!rows) return <PlanList />
  const name = PLAN_NAME[planId]()
  // Forking never touches the template itself — it only reads it once, here, to seed the
  // wizard's own local state, exactly as if every exercise had been picked by hand. The template
  // stays reloadable exactly as it was, and the fork becomes its own independent custom plan.
  const editAsCustom = () => nav('/plans/custom/new', {
    state: { fork: { name: t('{0} (edited)', name), mode: 'weekday', days: forkDaysFromRows(rows) } }
  })
  return <>
    <Header back={() => nav('/plans')} title={name} sub={t('{0} days per week', rows.length)} />
    <div className="list" style={{ marginBottom: 12 }}>
      {rows.map(({ day, name: routineName, emoji }) => (
        <div key={day} className="item" {...tappable(() => nav('/plans/' + planId + '/' + day))}>
          <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name={emoji} /></span>
          <div className="grow"><div className="tt">{t(DAYN[day])}</div><div className="ss">{routineName}</div></div>
          <Icon name="chevronRight" className="chev" />
        </div>
      ))}
    </div>
    <Button icon="pencil" onClick={editAsCustom}>{t('Edit as custom')}</Button>
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
