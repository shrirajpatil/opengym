// @vitest-environment happy-dom
// Plans is a read-only browser: list -> a plan's days -> a day's exercises -> the exercise's
// own detail sheet. It must never touch S.routines/S.week (that stays starterPlanSheet's job).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Plans from './Plans.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const params = vi.hoisted(() => ({ current: {} }))
const detailSheet = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', () => ({
  useParams: () => params.current,
  useNavigate: () => vi.fn()
}))
vi.mock('../sheets.jsx', () => ({ exerciseDetailSheet: detailSheet }))

const mounted = []
function render() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<Plans />))
  return host
}

beforeEach(() => { params.current = {}; detailSheet.mockClear(); document.body.innerHTML = '' })
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('Plans browser', () => {
  it('lists every starter plan with its day count', () => {
    const host = render()
    const names = [...host.querySelectorAll('.item .tt')].map(el => el.textContent)
    expect(names).toEqual(['Push / Pull / Legs', 'Upper / Lower', 'Full Body', '5×5', 'Beginner PPL ×2'])
    const beginnerRow = [...host.querySelectorAll('.item')].find(el => el.querySelector('.tt').textContent === 'Beginner PPL ×2')
    expect(beginnerRow.querySelector('.ss').textContent).toContain('6 days per week')
  })

  it('shows a plan\'s six days, Thursday included as a normal weekday', () => {
    params.current = { planId: 'ppl2-beginner' }
    const host = render()
    const days = [...host.querySelectorAll('.item .tt')].map(el => el.textContent)
    expect(days).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Friday', 'Saturday', 'Sunday'])
    expect(host.querySelector('h1').textContent).toBe('Beginner PPL ×2')
  })

  it('shows a day\'s exercises with sets x reps, in the order the plan defines', () => {
    params.current = { planId: 'ppl2-beginner', day: '1' }
    const host = render()
    const rows = [...host.querySelectorAll('.item .tt')].map(el => el.textContent)
    expect(rows[0].toLowerCase()).toContain('bench press')
    const subs = [...host.querySelectorAll('.item .ss')].map(el => el.textContent)
    expect(subs[0]).toBe('3 sets × 8 reps')
  })

  it('opens the shared exercise detail sheet on tap, and never touches routines/week', () => {
    params.current = { planId: 'ppl2-beginner', day: '1' }
    const host = render()
    act(() => { host.querySelector('.item').click() })
    expect(detailSheet).toHaveBeenCalledTimes(1)
    expect(detailSheet.mock.calls[0][0].id).toBe('0025')
  })

  it('falls back to the plan list for an unknown plan id or day', () => {
    params.current = { planId: 'not-a-real-plan' }
    let host = render()
    expect(host.querySelector('h1').textContent).toBe('Plans')

    act(() => { mounted.splice(0).forEach(root => root.unmount()) })
    document.body.innerHTML = ''
    params.current = { planId: 'ppl2-beginner', day: '99' }
    host = render()
    expect(host.querySelector('h1').textContent).toBe('Plans')
  })
})
