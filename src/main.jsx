import React, { lazy, Suspense, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Link, Route, Routes } from 'react-router-dom'
import { uuidPattern } from './format'
import './style.css'

import { Gift, Notice } from './ui'

const Organizer = lazy(() => import('./organizer').then(module => ({ default: module.Organizer })))
const Participant = lazy(() => import('./participant').then(module => ({ default: module.Participant })))

function Home() {
  const [joining, setJoining] = useState(false)
  const [invite, setInvite] = useState('')
  const [error, setError] = useState('')
  function openInvite(event) {
    event.preventDefault()
    const match = invite.trim().match(new RegExp('(?:^|#/join/)(' + uuidPattern + ')/*$'))
    if (!match) return setError('Paste the full invitation link from your organizer.')
    location.hash = '/join/' + match[1].toLowerCase()
  }
  return <>
    <section className="hero">
      <div className="hero-copy">
        <h1>Secret Santa,<br /><em>made merry.</em></h1>
        <p className="lede">Join a Christmas gift exchange and find out who you drew.</p>
        <button className="primary" onClick={() => setJoining(true)}>Join Secret Santa</button>
        {joining && <form className="join-inline" onSubmit={openInvite}>
          <label>Invitation link<input autoFocus required value={invite} onChange={e => setInvite(e.target.value)} /></label>
          <button className="secondary">Open invitation</button><Notice>{error}</Notice>
        </form>}
      </div>
      <div className="hero-art" aria-hidden="true">
        <div className="art-ring ring-inner" /><div className="art-ring ring-outer" />
        <span className="spark spark-a">✦</span><span className="spark spark-b">✧</span>
        <span className="spark spark-c">✦</span><span className="spark spark-d">✧</span>
        <div className="side-gift left-gift"><Gift /></div>
        <div className="side-gift right-gift"><Gift /></div>
        <Gift />
      </div>
    </section>
    <section className="steps" aria-label="How Secret Santa works">
      <article><span aria-hidden="true">◇</span><div><h2>Join the exchange</h2><p>Open your invitation and enter your personal passcode.</p></div></article>
      <article><span aria-hidden="true">✧</span><div><h2>Unwrap a name</h2><p>After the organizer generates the draw, open your gift to see who you drew.</p></div></article>
      <article><span aria-hidden="true">♡</span><div><h2>Keep the secret</h2><p>Bring a thoughtful gift and save the surprise for Christmas.</p></div></article>
    </section>
  </>
}

function Snow() {
  const flakes = Array.from({ length: 48 }, (_, i) => ({
    '--x': (i * 37.71) % 100 + '%', '--duration': 13 + i % 13 + 's',
    '--delay': -(i * 3.17 % 26) + 's', '--size': 2 + i % 4 + 'px',
  }))
  return <div className="snow" aria-hidden="true">{flakes.map((style, i) => <i key={i} style={style} />)}</div>
}

function App() {
  return <HashRouter>
    <Snow />
    <div className="site">
      <header><Link className="brand" to="/"><span aria-hidden="true">✳</span> Secret Santa</Link><Link className="nav-link" to="/organizer">Organizer</Link></header>
      <main><Suspense fallback={<p role="status">Loading…</p>}><Routes>
        <Route path="/" element={<Home />} />
        <Route path="/join/:invite" element={<Participant />} />
        <Route path="/organizer" element={<Organizer />} />
        <Route path="*" element={<section className="panel narrow"><h1>Page not found</h1><Link to="/">Back to Secret Santa</Link></section>} />
      </Routes></Suspense></main>
      <footer><span aria-hidden="true">✧</span> Secret Santa</footer>
    </div>
  </HashRouter>
}

createRoot(document.getElementById('root')).render(<App />)
