import { useEffect, useState } from 'react'
import { admin, supabase } from './api'
import { eventDate } from './format'
import { exportExchange } from './export'
import { Notice } from './ui'

export function Organizer() {
  const [session, setSession] = useState(undefined)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, value) => setSession(value))
    return () => subscription.unsubscribe()
  }, [])

  async function signIn(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: form.get('email').trim(), password: form.get('password'),
      })
      if (error) throw error
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
    <p className="eyebrow">Private organizer area</p><h1>Organizer sign-in</h1>
    <form onSubmit={signIn}>
      <label>Email<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form><Notice>{error}</Notice>
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
  const [showAssignments, setShowAssignments] = useState(false)
  const [showCodes, setShowCodes] = useState(false)
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
      setShowCodes(false)
      setShowAssignments(false)
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

  if (!exchanges) return error ? <Notice>{error}</Notice> : <p role="status">Loading exchanges…</p>
  const invite = exchange ? new URL('#/join/' + exchange.invite, location.href).href : ''
  const joined = snapshot?.participants.filter(p => p.joined_at).length
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
      </section>

      <section className="panel">
        <div className="section-heading"><div><h2>Participants</h2><p>{joined} of {total} joined</p></div>
          <button className="secondary" disabled={busy} onClick={() => mutate('details')}>Refresh</button></div>
        {!exchange.drawn_at && <form className="toolbar" onSubmit={event => {
          event.preventDefault()
          const form = event.currentTarget
          const name = new FormData(form).get('name')
          run(async () => { setSnapshot(await admin('add', exchange.id, { name })); form.reset() })
        }}>
          <label>Participant name<input name="name" maxLength={100} required /></label><button className="primary" disabled={busy}>Add participant</button>
        </form>}
        {!exchange.drawn_at && total > joined && <><p>Share the invitation link with everyone and send each joining code privately to its participant.</p>
          <button className="text-button" onClick={() => setShowCodes(!showCodes)}>{showCodes ? 'Hide joining codes' : 'Show joining codes'}</button></>}
        {total > 0 && <ul className="roster">{snapshot.participants.map(p => <li key={p.id}>
          <div><strong>{p.name}</strong><span className={p.joined_at ? 'joined' : 'pending'}>{p.joined_at ? 'Joined' : 'Awaiting join'}</span></div>
          <div className="row-actions">{showCodes && p.claim_code && <><code>{p.claim_code}</code><button className="text-button" disabled={busy} onClick={() => copy(p.claim_code, 'Joining code')}>Copy code</button></>}
          {!exchange.drawn_at && <button className="text-button" aria-label={'Remove ' + p.name} disabled={busy} onClick={() => {
            if (window.confirm('Remove ' + p.name + ' from this exchange?')) mutate('remove', { participant_id: p.id })
          }}>Remove</button>}</div>
        </li>)}</ul>}
      </section>

      <section className="panel">
        <div className="section-heading"><h2>Secret Santa draw</h2><button className="secondary" disabled={busy} onClick={() => run(async () => {
          const current = await admin('details', exchange.id)
          setSnapshot(current)
          await exportExchange(current)
          setMessage('Excel workbook downloaded.')
        })}>Export Excel</button></div>
        {exchange.drawn_at ? <>
          <p>Finalized {new Date(exchange.drawn_at).toLocaleString()}</p>
          <button className="secondary" onClick={() => setShowAssignments(!showAssignments)}>{showAssignments ? 'Hide assignments' : 'View private assignments'}</button>
          {showAssignments && <table><thead><tr><th scope="col">Giver</th><th scope="col">Recipient</th></tr></thead><tbody>
            {snapshot.assignments.map(a => <tr key={a.giver}><td>{a.giver}</td><td>{a.recipient}</td></tr>)}</tbody></table>}
        </> : <>
          <p>At least two participants are required. Everyone must join before you can finalize the draw.</p>
          <button className="primary" disabled={busy || total < 2 || joined !== total} onClick={() => {
            if (window.confirm('Finalize the Secret Santa draw? Assignments are permanent.')) mutate('draw')
          }}>Finalize draw</button>
        </>}
      </section>
      <section className="panel"><h2>Activity</h2><ul className="activity">{snapshot.activity.map((entry, index) => <li key={index}>
        <span>{entry.action}{entry.subject && ' · ' + entry.subject}</span><time dateTime={entry.occurred_at}>{new Date(entry.occurred_at).toLocaleString()}</time>
      </li>)}</ul></section>
    </>}
  </div>
}
