import { useEffect, useState } from 'react'
import { admin, rpc, supabase } from './api'
import { eventDate } from './format'
import { Notice } from './ui'

export function Organizer() {
  const [session, setSession] = useState(undefined)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [signingUp, setSigningUp] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!supabase) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, value) => setSession(value))
    return () => subscription.unsubscribe()
  }, [])

  async function submitCredentials(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const credentials = {
        email: form.get('email').trim(), password: form.get('password'),
      }
      if (signingUp) {
        const redirect = new URL(window.location.pathname, window.location.origin)
        redirect.hash = '/organizer'
        const { data, error } = await supabase.auth.signUp({
          ...credentials,
          options: {
            data: { merry_draw_organizer: true },
            emailRedirectTo: redirect.href,
          },
        })
        if (error) throw error
        if (!data.session) {
          setSigningUp(false)
          setMessage('Check your email for a confirmation link, then sign in.')
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword(credentials)
        if (error) throw error
      }
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    setError(error?.message ?? '')
  }

  if (!supabase) return <section className="panel narrow"><h1>Organizer</h1><Notice>Connect Supabase using the project setup instructions.</Notice></section>
  if (session === undefined) return <p role="status">Checking organizer session…</p>
  if (!session) return <section className="panel narrow">
    <h1>{signingUp ? 'Create an organizer account' : 'Organizer sign-in'}</h1>
    {message && <p role="status">{message}</p>}
    <form key={signingUp ? 'signup' : 'signin'} onSubmit={submitCredentials}>
      <label>Email<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete={signingUp ? 'new-password' : 'current-password'} required /></label>
      <button className="primary" disabled={busy}>{busy ? 'Please wait…' : signingUp ? 'Create account' : 'Sign in'}</button>
    </form><Notice>{error}</Notice>
    <p><button type="button" className="secondary" disabled={busy} onClick={() => {
      setSigningUp(!signingUp)
      setError('')
      setMessage('')
    }}>{signingUp ? 'Back to sign in' : 'Create an organizer account'}</button></p>
  </section>
  return <><div className="dashboard-head"><h1>Organizer</h1><button className="secondary" onClick={signOut}>Sign out</button></div>
    <Notice>{error}</Notice><Dashboard key={session.user.id} /></>
}

function ExchangeForm({ exchange, busy, onSave }) {
  return <form onSubmit={event => {
    event.preventDefault()
    onSave(Object.fromEntries(new FormData(event.currentTarget)))
  }}>
    <div className="form-grid">
      <label>Exchange name<input name="title" required maxLength={100} defaultValue={exchange?.title} /></label>
      <label>Exchange date<input name="event_date" type="date" required defaultValue={exchange?.event_date} /></label>
    </div>
    <label>Gift budget<input name="budget" maxLength={100} defaultValue={exchange?.budget} /></label>
    <label>Event details<textarea name="details" maxLength={1500} rows={3} defaultValue={exchange?.details} /></label>
    <button className="primary" disabled={busy}>{exchange ? 'Save details' : 'Create exchange'}</button>
  </form>
}

function Dashboard() {
  const [exchanges, setExchanges] = useState(null)
  const [snapshot, setSnapshot] = useState(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const exchange = snapshot?.exchange

  useEffect(() => {
    let active = true
    admin('list').then(result => { if (active) setExchanges(result) })
      .catch(err => { if (active) setError(err.message) })
    return () => { active = false }
  }, [])

  async function run(work) {
    setBusy(true)
    setError('')
    setMessage('')
    try { await work() }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  function select(id) {
    run(async () => {
      const result = id ? await admin('details', id) : null
      setSnapshot(result)
      setCreating(false)
      setEditing(false)
    })
  }

  function mutate(action, data) {
    return run(async () => {
      if (action === 'create') {
        const created = await admin('create', null, data)
        setExchanges(list => [created, ...list])
        setCreating(false)
        setSnapshot(await admin('details', created.id))
      } else {
        const updated = await admin(action, exchange.id, data)
        setSnapshot(updated)
        if (action === 'regenerate') {
          const participant = updated.participants.find(p => p.id === data.participant_id)
          setMessage('Send the new passcode privately to ' + participant.name + '.')
        }
        if (action === 'reassign') setMessage('Draw reassigned. Ask participants to check their gift again.')
        if (action === 'update') {
          setExchanges(list => list.map(item => item.id === exchange.id ? updated.exchange : item))
          setEditing(false)
        }
      }
    })
  }

  function copy(text, label) {
    run(async () => {
      await navigator.clipboard.writeText(text)
      setMessage(label + ' copied.')
    })
  }

  function deleteEvent() {
    if (!window.confirm(`Delete “${exchange.title}” permanently? This will remove its participants and assignments and disable its invitation link.`)) return
    run(async () => {
      await rpc('merry_delete_exchange', { p_id: exchange.id })
      setExchanges(list => list.filter(item => item.id !== exchange.id))
      setSnapshot(null)
      setEditing(false)
      setMessage('Event deleted.')
    })
  }

  if (!exchanges) return error ? <Notice>{error}</Notice> : <p role="status">Loading exchanges…</p>
  const invite = exchange ? new URL('#/join/' + exchange.invite, location.href).href : ''
  const total = snapshot?.participants.length

  return <div className="dashboard">
    <section className="panel">
      <div className="toolbar">
        <label>Exchange<select value={exchange?.id ?? ''} disabled={busy} onChange={event => select(event.target.value)}>
          <option value="">Choose an exchange</option>
          {exchanges.map(item => <option key={item.id} value={item.id}>{item.title} · {eventDate(item.event_date)}</option>)}
        </select></label>
        <button className="primary" disabled={busy} onClick={() => { setCreating(!creating); setSnapshot(null); setEditing(false); setError(''); setMessage('') }}>{creating ? 'Cancel' : 'New exchange'}</button>
      </div>
      {creating && <ExchangeForm busy={busy} onSave={data => mutate('create', data)} />}
      {!creating && !exchange && exchanges.length === 0 && <p>Create an exchange to start your invitation list.</p>}
      <Notice>{error}</Notice>
      <p className="status" role="status">{message}</p>
    </section>

    {exchange && <>
      <section className="panel" key={exchange.id}>
        <div className="section-heading"><div><p className="eyebrow">{exchange.drawn_at ? 'Draw finalized' : 'Gathering participants'}</p><h2>{exchange.title}</h2></div>
          <button className="secondary" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? 'Cancel edit' : 'Edit details'}</button></div>
        {editing ? <ExchangeForm exchange={exchange} busy={busy} onSave={data => mutate('update', data)} /> :
          <><p className="event-meta">{eventDate(exchange.event_date)}{exchange.budget && <span>Gift budget · {exchange.budget}</span>}</p>
          {exchange.details && <p className="event-details">{exchange.details}</p>}</>}
        <div className="toolbar invitation">
          <label>Shared invitation link<input value={invite} readOnly onFocus={event => event.target.select()} /></label>
          <button className="secondary" disabled={busy} onClick={() => copy(invite, 'Invitation link')}>Copy link</button>
        </div>
        <button className="secondary" disabled={busy} onClick={deleteEvent}>Delete event</button>
      </section>

      <section className="panel">
        <h2>Participants</h2>
        {!exchange.drawn_at && <form className="toolbar" onSubmit={event => {
          event.preventDefault()
          const form = event.currentTarget
          const name = new FormData(form).get('name')
          run(async () => {
            const updated = await admin('add', exchange.id, { name })
            const previousCodes = new Map(snapshot.participants.map(p => [p.id, p.passcode]))
            const changed = updated.participants.filter(p => previousCodes.has(p.id) && previousCodes.get(p.id) !== p.passcode)
            setSnapshot(updated)
            form.reset()
            if (changed.length) setMessage('Send updated passcodes privately to ' + changed.map(p => p.name).join(', ') + '.')
          })
        }}>
          <label>Participant name<input name="name" maxLength={100} required /></label><button className="primary" disabled={busy}>Add participant</button>
        </form>}
        {total > 0 && <>
          <p>Share the invitation link with everyone and send each person their passcode privately.</p>
          <button className="secondary" disabled={busy} onClick={() => mutate('details')}>Refresh passcode status</button>
          <table className="passcode-table">
            <thead><tr><th scope="col">Participant</th><th scope="col">Passcode</th></tr></thead>
            <tbody>{snapshot.participants.map(p => <tr key={p.id}>
              <th scope="row">{p.name}
                <small className="passcode-status">{p.first_passcode_entry_at
                  ? <>Passcode entered <time dateTime={p.first_passcode_entry_at}>{new Date(p.first_passcode_entry_at).toLocaleString()}</time></>
                  : 'No recorded entry'}</small>
              </th>
              <td><div className="row-actions">
                <code>{p.passcode}</code>
                <button className="text-button" aria-label={'Copy passcode for ' + p.name} disabled={busy} onClick={() => copy(p.passcode, 'Passcode')}>Copy</button>
              </div>
              {!exchange.drawn_at && <div className="row-actions">
                <button className="text-button" aria-label={'Regenerate passcode for ' + p.name} disabled={busy} onClick={() => mutate('regenerate', { participant_id: p.id })}>Regenerate</button>
                <button className="text-button" aria-label={'Remove ' + p.name} disabled={busy} onClick={() => {
                  if (window.confirm('Remove ' + p.name + ' from this exchange?')) mutate('remove', { participant_id: p.id })
                }}>Remove</button>
              </div>}</td>
            </tr>)}</tbody>
          </table>
        </>}
      </section>

      <section className="panel">
        <h2>Secret Santa draw</h2>
        {exchange.drawn_at ? <>
          <p>Finalized {new Date(exchange.drawn_at).toLocaleString()}</p>
          {total >= 3 && <button className="secondary" disabled={busy} onClick={() => {
            if (window.confirm('Replace the current assignments? Anyone who already opened a gift should check their result again.')) mutate('reassign')
          }}>Reassign draw</button>}
        </> : <>
          <p>Add at least three participants. The draw avoids self-matches and two-way gift swaps.</p>
          <button className="primary" disabled={busy || total < 3} onClick={() => {
            if (window.confirm('Generate the Secret Santa draw and make assignments available to participants?')) mutate('draw')
          }}>Generate Secret Santa</button>
        </>}
      </section>
      <section className="panel"><h2>Activity</h2><ul className="activity">{snapshot.activity.map((entry, index) => <li key={index}>
        <span>{entry.action}{entry.subject && ' · ' + entry.subject}</span><time dateTime={entry.occurred_at}>{new Date(entry.occurred_at).toLocaleString()}</time>
      </li>)}</ul></section>
    </>}
  </div>
}
