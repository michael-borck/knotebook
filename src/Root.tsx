import { Suspense, lazy } from 'react'

const App = lazy(() => import('./App.tsx'))
const Player = lazy(() => import('./Player.tsx'))
const UpdateBanner = lazy(() => import('./components/UpdateBanner'))

export default function Root({ isPlayer }: { isPlayer: boolean }) {
  return (
    <Suspense fallback={<p className="loading">Loading…</p>}>
      <UpdateBanner />
      {isPlayer ? <Player /> : <App />}
    </Suspense>
  )
}