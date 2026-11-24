import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { rpc } from './api'
import { eventDate, uuidPattern } from './format'
import { Gift, Notice } from './ui'

export function Participant() {
  const { invite } = useParams()
  return <Invitation key={invite.toLowerCase()} invite={invite.toLowerCase()} />
}

function Invitation({ invite }) {
  const [event, setEvent] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [passcode, setPasscode] = useState('')
  const [person, setPerson] = useState(null)
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState(false)
  const giftButton = useRef(null)

  function openGift() {
    if (opened) return
    giftButton.current?.focus()
    setOpened(true)
  }

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
      const result = await rpc('merry_participant', { p_invite: invite, p_passcode: passcode })
      if (result.status === 'limited') {
        setError('Too many incorrect attempts for this invitation. Please wait 30 minutes and try again.')
      } else if (result.status === 'invalid') {
        setPerson(null)
        setError('That passcode did not match. Double-check the word your organizer sent you.')
      } else {
        setPerson(result)
        if (result.recipient) setPasscode('')
      }
    } catch {
      setError('We could not open your exchange right now. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="panel narrow participant">
    <p className="eyebrow">Your Christmas exchange</p>
    {loadError ? <Notice>{loadError}</Notice> : !event ? <p role="status">Opening invitation…</p> : <>
      <h1>{event.title}</h1>
      <p className="event-meta"><time dateTime={event.event_date}>{eventDate(event.event_date)}</time>{event.budget && <span>Gift budget · {event.budget}</span>}</p>
      {event.details && <p className="event-details">{event.details}</p>}
      <div className="participant-content">
        {person && <h2>Hello, {person.name}</h2>}
        {person?.recipient ? <div className="gift-reveal">
          <button ref={giftButton} className="gift-trigger" type="button"
            aria-label={opened ? 'Gift opened' : 'Unwrap your gift'} aria-disabled={opened} onClick={openGift}>
            <Gift open={opened} />
          </button>
          <div aria-live="polite">{opened && <div className="recipient"><p>You’re Secret Santa for</p><h2>{person.recipient}</h2></div>}</div>
          {!opened && <button className="primary" type="button" onClick={openGift}>Open my gift</button>}
        </div> : <form onSubmit={access}>
          {person ? <p>The draw is still waiting for your organizer. Check back soon!</p> :
            <label>Personal passcode<input name="passcode" type="password" required maxLength={32} autoComplete="off"
              autoCapitalize="none" spellCheck={false} value={passcode}
              onChange={e => setPasscode(e.target.value)} disabled={busy} placeholder="Word from your organizer" /></label>}
          <button className="primary" disabled={busy}>{busy ? 'Opening…' : person ? 'Check for my assignment' : 'Open my exchange'}</button>
        </form>}
        {person && <button className="text-button" disabled={busy} onClick={() => {
          setPerson(null)
          setPasscode('')
          setOpened(false)
          setError('')
        }}>Back to passcode entry</button>}
      </div>
      <Notice>{error}</Notice>
    </>}
  </section>
}
