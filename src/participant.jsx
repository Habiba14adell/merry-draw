import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { rpc } from './api'
import { accessPattern, eventDate, newAccessKey, uuidPattern } from './format'
import { Gift, Notice } from './ui'

function readKey(storageKey) {
  try { return localStorage.getItem(storageKey) || '' } catch { return '' }
}

export function Participant() {
  const { invite } = useParams()
  return <Invitation key={invite.toLowerCase()} invite={invite.toLowerCase()} />
}

function Invitation({ invite }) {
  const keyName = 'merry-draw:' + invite
  const [event, setEvent] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [key, setKey] = useState(() => readKey(keyName))
  const [mode, setMode] = useState(() => readKey(keyName) ? 'return' : 'join')
  const [person, setPerson] = useState(null)
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    let active = true
    async function loadEvent() {
      try {
        if (!new RegExp('^' + uuidPattern + '$').test(invite)) throw new Error('Invitation not found.')
        const data = await rpc('merry_event', { p_invite: invite })
        if (!data) throw new Error('Invitation not found.')
        if (active) setEvent(data)
      } catch (err) {
        if (active) setLoadError(err.message)
      }
    }
    loadEvent()
    return () => { active = false }
  }, [invite])

  async function access(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const form = new FormData(event.currentTarget)
      const token = mode === 'join' ? readKey(keyName + ':pending') || key || newAccessKey() : form.get('key').trim().toLowerCase()
      setKey(token)
      if (mode === 'join') {
        try { localStorage.setItem(keyName + ':pending', token) } catch {}
      }
      const result = await rpc('merry_participant', {
        p_invite: invite, p_token: token, p_code: mode === 'join' ? form.get('code').trim() : null,
      })
      try {
        localStorage.setItem(keyName, token)
        localStorage.removeItem(keyName + ':pending')
      } catch { setShowKey(true) }
      if (mode === 'join') setShowKey(true)
      setPerson(result)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function refresh() {
    setBusy(true)
    setError('')
    try {
      setPerson(await rpc('merry_participant', { p_invite: invite, p_token: key }))
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function copyKey() {
    try { await navigator.clipboard.writeText(key); setCopied(true) }
    catch { setError('Copy the access key directly from the field.') }
  }

  return <section className="panel narrow participant">
    <p className="eyebrow">Your Christmas exchange</p>
    {loadError ? <Notice>{loadError}</Notice> : !event ? <p role="status">Opening invitation…</p> : <>
      <h1>{event.title}</h1>
      <p className="event-meta"><time dateTime={event.event_date}>{eventDate(event.event_date)}</time>{event.budget && <span>Gift budget · {event.budget}</span>}</p>
      {event.details && <p className="event-details">{event.details}</p>}
      {person ? <div className="participant-content">
        <h2>Hello, {person.name}</h2>
        {person.recipient ? <>
          <Gift open={opened} />
          <div aria-live="polite">{opened && <div className="recipient"><p>You’re Secret Santa for</p><h2>{person.recipient}</h2></div>}</div>
          {!opened && <button className="primary" onClick={() => setOpened(true)}>Open my gift</button>}
        </> : <><p>You’re in! Check back after the organizer finalizes the draw.</p><button className="secondary" disabled={busy} onClick={refresh}>Check for my assignment</button></>}
        <div className="key-area">
          <button className="text-button" onClick={() => { setShowKey(!showKey); setCopied(false) }}>{showKey ? 'Hide private access key' : 'Save my private access key'}</button>
          {showKey && <><p>Keep this key to open your assignment on another device.</p><input aria-label="Private access key" readOnly value={key} onFocus={e => e.target.select()} /><button className="secondary" onClick={copyKey}>{copied ? 'Copied' : 'Copy access key'}</button></>}
          <button className="text-button" onClick={() => {
            try { localStorage.removeItem(keyName); localStorage.removeItem(keyName + ':pending') } catch {}
            setPerson(null); setKey(''); setOpened(false); setShowKey(false); setCopied(false); setMode('return'); setError('')
          }}>Clear access from this browser</button>
        </div>
      </div> : <div className="participant-content">
        <div className="toggle"><button aria-pressed={mode === 'join'} disabled={busy} onClick={() => { setMode('join'); setError('') }}>Join exchange</button><button aria-pressed={mode === 'return'} disabled={busy} onClick={() => { setMode('return'); setError('') }}>Return to my draw</button></div>
        <form key={mode} onSubmit={access}>
          {mode === 'join' ? <label>Personal joining code<input name="code" required pattern={uuidPattern} autoComplete="off" placeholder="Code from your organizer" /></label>
            : <label>Private access key<input name="key" type="password" required defaultValue={key} pattern={accessPattern} autoComplete="off" /></label>}
          <button className="primary" disabled={busy}>{busy ? 'Opening…' : mode === 'join' ? 'Join Secret Santa' : 'Open my exchange'}</button>
        </form>
      </div>}
      <Notice>{error}</Notice>
    </>}
  </section>
}
