// @vitest-environment happy-dom
// The custom-plan wizard: name -> mode -> per-day exercises -> save. Its job ends the same way
// loading a starter plan does (routines pushed, a schedule or a cyclePlan written), so this
// mostly checks that both modes produce the right shape, not that a wizard UI "feels right."
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sheets = vi.hoisted(() => ({ exercisePicker: vi.fn(), confirmSheet: vi.fn() }))
vi.mock('../sheets.jsx', () => sheets)

import CustomPlanWizard from './CustomPlanWizard.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { todayISO } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))

let root, host
function render() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter><Routes><Route path="*" element={<CustomPlanWizard />} /></Routes></MemoryRouter>))
}
const click = el => act(() => el.click())
const type = (el, value) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const byText = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

beforeEach(() => {
  useStore.setState({ S: clone(DEF), user: { id: 'u1' }, ready: true })
  sheets.exercisePicker.mockReset()
  document.body.innerHTML = ''
})
afterEach(() => { act(() => root?.unmount()) })

describe('CustomPlanWizard — weekday mode', () => {
  it('writes routines and a week schedule, stamped with a shared sourcePlanId', () => {
    render()
    type(host.querySelector('input'), 'My Split')
    click(byText('Next'))

    // exercisePicker's mock calls its onPick argument directly — the wizard never sees a real
    // picker UI, only the exercise it "chose".
    sheets.exercisePicker.mockImplementation(onPick => onPick({ id: '0025', n: 'barbell bench press' }))
    click(host.querySelector('.btn.ghost.sm')) // "Add exercise" on the first day row (Sunday)
    click(byText('Save plan'))

    const S = useStore.getState().S
    expect(S.routines).toHaveLength(1)
    const r = S.routines[0]
    expect(r.ex).toEqual([{ id: '0025', sets: 3, reps: 10, weight: 0, mode: 'reps' }])
    expect(r.sourcePlanId).toMatch(/^custom-/)
    expect(S.week[0]).toEqual([r.id])   // day index 0 = Sunday, DAYN's own ordering
    expect(S.cyclePlan).toBeNull()
  })

  it('Save plan stays disabled until a name is entered and at least one exercise is added', () => {
    render()
    expect(byText('Next').disabled).toBe(true)
    type(host.querySelector('input'), 'X')
    expect(byText('Next').disabled).toBe(false)
    click(byText('Next'))
    expect(byText('Save plan').disabled).toBe(true)
  })
})

describe('CustomPlanWizard — rolling cycle mode', () => {
  it('writes a cyclePlan instead of a week schedule, with routineIds in day order', () => {
    render()
    type(host.querySelector('input'), 'Cycle Split')
    click([...host.querySelectorAll('.seg button')].find(b => b.textContent === 'Rolling cycle'))
    click(byText('Next'))

    let call = 0
    sheets.exercisePicker.mockImplementation(onPick => onPick({ id: ['0025', '0027', '0043'][call++], n: 'x' }))
    const dayRows = [...host.querySelectorAll('.item')]
    click(dayRows[0].querySelector('.btn.ghost.sm'))
    click(dayRows[1].querySelector('.btn.ghost.sm'))
    click(byText('Save plan'))

    const S = useStore.getState().S
    expect(S.week).toEqual({})
    expect(S.cyclePlan.active).toBe(true)
    expect(S.cyclePlan.routineIds).toHaveLength(2)   // only the two days that got an exercise
    expect(S.cyclePlan.sourcePlanId).toMatch(/^custom-/)
    expect(S.cyclePlan.startDate).toBe(todayISO())
  })

  it('asks before switching away from an existing week schedule, never blocking it', () => {
    useStore.setState(s => ({ S: { ...s.S, week: { 1: ['old'] }, routines: [{ id: 'old', name: 'Old', emoji: 'star', ex: [] }] } }))
    render()
    type(host.querySelector('input'), 'Cycle Split')
    click([...host.querySelectorAll('.seg button')].find(b => b.textContent === 'Rolling cycle'))
    click(byText('Next'))
    sheets.exercisePicker.mockImplementation(onPick => onPick({ id: '0025', n: 'x' }))
    click(host.querySelectorAll('.item')[0].querySelector('.btn.ghost.sm'))
    click(byText('Save plan'))

    expect(sheets.confirmSheet).toHaveBeenCalledTimes(1)
    // The existing week plan is untouched until (and unless) the confirmation is accepted.
    expect(useStore.getState().S.week).toEqual({ 1: ['old'] })
  })
})
