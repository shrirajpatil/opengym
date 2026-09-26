// @vitest-environment happy-dom
// The setting itself: Settings' toggle has to write weekStart. Plan.jsx no longer renders a
// week grid at all (Plan's main screen is the plan-selection list; the removed grid's tests
// moved out with it), but weekOrder/weekStartOf still drive the weekday plan model everywhere
// else (RoutineEdit, Home, Workout, the reminder builder), which is what still needs this setting
// respected — those already have their own coverage.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({
    S: state.S,
    user: null,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
    replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, isAndroid: () => Promise.resolve(false), shareExport: vi.fn(), syncReminder: vi.fn() }))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => null }))
vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),
  dayAssignSheet: vi.fn(), dayAddRoutineSheet: vi.fn(), planToolsSheet: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

let host, root
beforeEach(() => {
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {}, week: {}, dayPlan: {},
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const segButton = label => [...host.querySelectorAll('.seg button')].find(b => b.textContent === label)

describe('Settings — week starts on', () => {
  const mount = () => act(() => root.render(<Settings />))

  it('offers Monday and Sunday and writes the getDay() index', () => {
    mount()
    expect(segButton('Monday').getAttribute('aria-pressed')).toBe('true')
    act(() => { segButton('Sunday').click() })
    expect(mocks.S.weekStart).toBe(0)
    mount()
    expect(segButton('Sunday').getAttribute('aria-pressed')).toBe('true')
    act(() => { segButton('Monday').click() })
    expect(mocks.S.weekStart).toBe(1)
  })

  it('shows a profile written before the setting existed as Monday', () => {
    delete mocks.S.weekStart
    mount()
    expect(segButton('Monday').getAttribute('aria-pressed')).toBe('true')
    expect(segButton('Sunday').getAttribute('aria-pressed')).toBe('false')
  })
})
