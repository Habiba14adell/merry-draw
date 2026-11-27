import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

test('personal passcodes, draws and reassignments enforce exchange privacy', async t => {
  const db = new PGlite({ extensions: { pgcrypto } })
  t.after(() => db.close())
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(
      id uuid primary key default gen_random_uuid(),
      email_confirmed_at timestamptz,
      raw_app_meta_data jsonb,
      raw_user_meta_data jsonb
    );
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
  `)
  const apply = async file => db.exec(await readFile(new URL('../supabase/' + file, import.meta.url), 'utf8'))
  await apply('schema.sql')
  const users = (await db.query('insert into auth.users (id) values (default),(default),(default) returning id')).rows
  await db.query('insert into merry_private.organizers values ($1),($2)', [users[0].id, users[1].id])
  const login = async user => {
    await db.exec('reset role')
    await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', user?.id ?? ''])
    await db.exec(user ? 'set role authenticated' : 'set role anon')
  }
  const call = async (sql, args) => (await db.query('select ' + sql + ' as result', args)).rows[0].result
  const admin = (action, id = null, data = {}) => call('public.merry_admin($1,$2,$3)', [action, id, data])
  const event = invite => call('public.merry_event($1)', [invite])
  const participant = (invite, code) => call('public.merry_participant($1,$2)', [invite, code])

  await login(users[0])
  const details = { title: 'Christmas Exchange', event_date: '2026-12-25', budget: '$25', details: 'Meet at noon.' }
  const legacy = await admin('create', null, { ...details, title: 'Last Christmas' })
  const legacyTokens = ['a'.repeat(64), 'b'.repeat(64)]
  for (const [index, name] of ['Alex', 'Blair'].entries()) {
    const added = (await admin('add', legacy.id, { name })).participants.find(p => p.name === name)
    await call('public.merry_participant($1,$2,$3)', [legacy.invite, legacyTokens[index], added.claim_code])
  }
  const legacyDraw = await admin('draw', legacy.id)

  await db.exec('reset role')
  await apply('migrations/202611240001_personal_passcodes.sql')
  await apply('migrations/202611250001_prevent_reciprocal_draws.sql')
  await apply('migrations/202611270001_organizer_signup.sql')
  await apply('migrations/202611270002_delete_exchange.sql')
  await apply('migrations/202611270003_refresh_draw_reassignment.sql')
  await apply('migrations/202611270004_track_passcode_entry.sql')
  const signup = (await db.query(`
    insert into auth.users (raw_app_meta_data, raw_user_meta_data)
    values ('{"provider":"email"}', '{"merry_draw_organizer":true}') returning id
  `)).rows[0]
  await login(signup)
  await assert.rejects(admin('list'), /Organizer access required/)
  await db.exec('reset role')
  await db.query('update auth.users set email_confirmed_at = now() where id = $1', [signup.id])
  await login(signup)
  assert.deepEqual(await admin('list'), [])
  await assert.rejects(admin('details', legacy.id), /Exchange not found/)
  await login(users[0])
  const migrated = await admin('details', legacy.id)
  assert.deepEqual(migrated.assignments, legacyDraw.assignments)
  assert.equal(migrated.exchange.drawn_at, legacyDraw.exchange.drawn_at)
  await assert.rejects(admin('reassign', legacy.id), /at least three/)
  await login()
  for (const person of migrated.participants) {
    assert.deepEqual(await participant(legacy.invite, person.passcode), {
      status: 'ok', name: person.name, recipient: migrated.assignments.find(a => a.giver === person.name).recipient,
    })
  }

  await login(users[0])
  const { id, invite } = await admin('create', null, details)
  assert.ok((await admin('list')).some(exchange => exchange.id === id))
  assert.equal((await admin('update', id, { ...details, budget: '$30' })).exchange.budget, '$30')
  await assert.rejects(admin('draw', id), /at least three/)
  await assert.rejects(admin('reassign', id), /Generate the draw before reassigning/)
  const initial = (await admin('add', id, { name: 'Alex' })).participants[0]
  // If a newly added name matches an existing word, the word must be replaced.
  const overlap = await admin('add', id, { name: initial.passcode })
  await assert.rejects(admin('draw', id), /at least three/)
  const named = overlap.participants.find(p => p.name === initial.passcode)
  assert.ok(overlap.participants.every(p => !p.passcode.includes(initial.passcode)))
  assert.notEqual(overlap.participants.find(p => p.id === initial.id).passcode, initial.passcode)
  await admin('remove', id, { participant_id: named.id })

  for (const name of ['Blair', 'Casey', 'Drew', 'Rivér']) await admin('add', id, { name })
  await assert.rejects(admin('add', id, { name: 'alex' }), /unique constraint/)
  const roster = (await admin('details', id)).participants
  assert.equal(new Set(roster.map(p => p.passcode)).size, roster.length)
  assert.ok(roster.every(p => /^[A-Z]+$/.test(p.passcode) && !p.passcode.includes('RIVER')))
  const refreshed = await admin('regenerate', id, { participant_id: initial.id })
  const replacement = refreshed.participants.find(p => p.id === initial.id)
  assert.notEqual(replacement.passcode, roster.find(p => p.id === initial.id).passcode)
  assert.ok(!roster.some(p => p.passcode === replacement.passcode))
  assert.deepEqual(refreshed.assignments, [])

  await db.exec('reset role')
  assert.equal(await call('merry_private.name_overlaps_word($1,$2)', [id, 'RIVER']), true)
  assert.equal(await call('merry_private.name_overlaps_word($1,$2)', [id, 'RIVERBANK']), true)
  await assert.rejects(db.query(`
    insert into merry_private.passcodes (exchange_id, word_hash)
    select exchange_id, word_hash from merry_private.passcodes where exchange_id = $1 limit 1
  `, [id]), /passcodes_pkey/)
  const protectedTables = (await db.query(`
    select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'merry_private' and c.relkind = 'r'
  `)).rows
  assert.equal(protectedTables.length, 8)
  assert.ok(protectedTables.every(table => table.relrowsecurity))

  await login(users[2])
  await assert.rejects(admin('list'), /Organizer access required/)
  await login(users[1])
  assert.deepEqual(await admin('list'), [])
  await assert.rejects(admin('details', id), /Exchange not found/)
  await assert.rejects(admin('draw', id), /Exchange not found/)
  await assert.rejects(admin('reassign', id), /Exchange not found/)
  await assert.rejects(admin('regenerate', id, { participant_id: initial.id }), /Exchange not found/)

  await login()
  await assert.rejects(admin('list'), /permission denied/)
  for (const table of ['assignments', 'participants', 'passcodes', 'passcode_keys']) {
    await assert.rejects(db.query('select * from merry_private.' + table), /permission denied/)
  }
  const publicDetails = await event(invite)
  assert.deepEqual(Object.keys(publicDetails).sort(), ['budget', 'details', 'drawn_at', 'event_date', 'title'])
  assert.equal(await event(id), null)
  assert.deepEqual(await participant(invite, 'bad-code1'), { status: 'invalid' })
  assert.deepEqual(await participant(invite, initial.passcode), { status: 'invalid' })
  assert.deepEqual(await participant(invite, roster.find(p => p.id === initial.id).passcode), { status: 'invalid' })
  assert.deepEqual(await participant(invite, replacement.passcode), { status: 'ok', name: 'Alex', recipient: null })

  await login(users[0])
  const result = await admin('draw', id)
  const firstEntry = result.participants.find(p => p.id === initial.id).first_passcode_entry_at
  assert.ok(Number.isFinite(Date.parse(firstEntry)))
  assert.ok(result.participants.filter(p => p.id !== initial.id).every(p => p.first_passcode_entry_at === null))
  assert.equal(result.assignments.length, roster.length)
  assert.equal(new Set(result.assignments.map(a => a.giver)).size, roster.length)
  assert.equal(new Set(result.assignments.map(a => a.recipient)).size, roster.length)
  assert.ok(result.assignments.every(a => a.giver !== a.recipient))
  assert.ok(result.assignments.every(a => !result.assignments.some(
    other => a.giver === other.recipient && a.recipient === other.giver,
  )))
  await assert.rejects(admin('draw', id), /already final/)
  await assert.rejects(admin('add', id, { name: 'Late' }), /already final/)
  await assert.rejects(admin('remove', id, { participant_id: initial.id }), /already final/)
  await assert.rejects(admin('regenerate', id, { participant_id: initial.id }), /already final/)
  assert.deepEqual((await admin('details', id)).assignments, result.assignments)
  const another = await admin('create', null, { ...details, title: 'Another Christmas' })

  await login()
  assert.deepEqual(await participant(another.invite, replacement.passcode), { status: 'invalid' })
  for (const person of refreshed.participants) {
    const recipient = result.assignments.find(a => a.giver === person.name).recipient
    const expected = { status: 'ok', name: person.name, recipient }
    assert.deepEqual(await participant(invite, person.passcode), expected)
    assert.deepEqual(await participant(invite, ' ' + person.passcode.toLowerCase() + ' '), expected)
  }
  for (let i = 0; i < 3; i++) assert.deepEqual(await participant(invite, 'notaword'), { status: 'invalid' })
  assert.deepEqual(await participant(invite, replacement.passcode), { status: 'limited' })
  await db.exec("reset role; update merry_private.passcode_attempts set window_started = clock_timestamp() - interval '31 minutes'")
  await login()
  assert.equal((await participant(invite, replacement.passcode)).status, 'ok')

  await assert.rejects(admin('reassign', id), /permission denied/)
  await login(users[0])
  const participantsBeforeReassign = (await admin('details', id)).participants
  assert.ok(participantsBeforeReassign.every(p => p.first_passcode_entry_at))
  assert.equal(participantsBeforeReassign.find(p => p.id === initial.id).first_passcode_entry_at, firstEntry)
  const reassigned = await admin('reassign', id)
  assert.notDeepEqual(reassigned.assignments, result.assignments)
  assert.deepEqual(reassigned.participants, participantsBeforeReassign)
  assert.equal(reassigned.exchange.invite, invite)
  assert.equal(reassigned.assignments.length, roster.length)
  assert.equal(new Set(reassigned.assignments.map(a => a.recipient)).size, roster.length)
  assert.ok(reassigned.assignments.every(a => !reassigned.assignments.some(
    other => a.giver === other.recipient && a.recipient === other.giver,
  )))
  await login()
  for (const person of reassigned.participants) {
    const expected = reassigned.assignments.find(a => a.giver === person.name).recipient
    assert.deepEqual(await participant(invite, person.passcode), { status: 'ok', name: person.name, recipient: expected })
  }
  const deleteExchange = () => call('public.merry_delete_exchange($1)', [id])
  await assert.rejects(deleteExchange(), /permission denied/)
  await login(users[1])
  await assert.rejects(deleteExchange(), /Exchange not found/)
  await login(users[0])
  const beforeDelete = await admin('list')
  await deleteExchange()
  assert.deepEqual(await admin('list'), beforeDelete.filter(exchange => exchange.id !== id))
  await login()
  assert.equal(await event(invite), null)
  assert.deepEqual(await participant(invite, replacement.passcode), { status: 'invalid' })
})
