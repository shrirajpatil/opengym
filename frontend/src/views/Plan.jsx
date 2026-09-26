import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { planToolsSheet, cycleResyncSheet } from '../sheets.jsx'
import { cycleDayIndex } from '../lib/history.js'
import { PlanSelectList } from './Plans.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Switch } from '../components/ui.jsx'
import { glyphOf } from '../lib/glyphs.js'
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

  return <>
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
    </div>
    {showCoach && <button className="coach-cta" onClick={() => nav('/coach')} style={{ marginBottom: 14 }}>
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

    <h4 className="sec">{t('Plans')}</h4>
    <PlanSelectList />
  </>
}
