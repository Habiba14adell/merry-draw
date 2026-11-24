import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { workbookData } from '../src/export.js'

test('database enforces the complete exchange lifecycle and role boundaries', async t => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
  `)
  await db.exec(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'))
  const users = (await db.query('insert into auth.users values (default),(default),(default) returning id')).rows
  await db.query('insert into merry_private.organizers values ($1),($2)', [users[0].id, users[1].id])
  const login = async user => {
    await db.exec('reset role')
    await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', user?.id ?? ''])
    await db.exec(user ? 'set role authenticated' : 'set role anon')
  }
  const call = async (sql, args) => (await db.query('select ' + sql + ' as result', args)).rows[0].result
  const admin = (action, id = null, data = {}) => call('public.merry_admin($1,$2,$3)', [action, id, data])
  const event = invite => call('public.merry_event($1)', [invite])
  const participant = (invite, token, code = null) => call('public.merry_participant($1,$2,$3)', [invite, token, code])

  await login()
  await assert.rejects(admin('list'), /permission denied/)
  await assert.rejects(db.query('select * from merry_private.assignments'), /permission denied/)

  await login(users[2])
  await assert.rejects(admin('list'), /Organizer access required/)
  await login(users[0])
  const details = { title: 'Family Christmas', event_date: '2026-12-25', budget: '$25', details: 'Meet at noon.' }
  const created = await admin('create', null, details)
  const { id, invite } = created
  assert.equal((await admin('list'))[0].id, id)
  assert.equal((await admin('update', id, { ...details, budget: '$30' })).exchange.budget, '$30')
  await assert.rejects(admin('draw', id), /at least two/)
  const initial = await admin('add', id, { name: 'Temporary' })
  await admin('remove', id, { participant_id: initial.participants[0].id })
  for (const name of ['Alex', 'Blair', 'Casey', 'Drew']) await admin('add', id, { name })
  await assert.rejects(admin('add', id, { name: 'alex' }), /unique constraint/)
  const roster = (await admin('details', id)).participants
  await assert.rejects(admin('draw', id), /Everyone must join/)

  await login(users[1])
  assert.deepEqual(await admin('list'), [])
  await assert.rejects(admin('details', id), /Exchange not found/)
  await assert.rejects(admin('draw', id), /Exchange not found/)

  await login()
  const publicDetails = await event(invite)
  assert.deepEqual(Object.keys(publicDetails).sort(), ['budget', 'details', 'drawn_at', 'event_date', 'title'])
  assert.equal(await event(id), null)
  const tokens = ['a', 'b', 'c', 'd'].map(letter => letter.repeat(64))
  await assert.rejects(participant(invite, tokens[0], id), /joining code/)
  for (const [index, person] of roster.entries()) {
    assert.deepEqual(await participant(invite, tokens[index], person.claim_code), { name: person.name, recipient: null })
  }
  assert.deepEqual(await participant(invite, tokens[0], roster[0].claim_code), { name: roster[0].name, recipient: null })
  await assert.rejects(participant(invite, 'e'.repeat(64), roster[0].claim_code), /already been used/)
  await assert.rejects(participant(invite, 'invalid'), /Invalid private access key/)

  await login(users[0])
  const result = await admin('draw', id)
  assert.equal(result.assignments.length, roster.length)
  assert.equal(new Set(result.assignments.map(a => a.giver)).size, roster.length)
  assert.equal(new Set(result.assignments.map(a => a.recipient)).size, roster.length)
  assert.ok(result.assignments.every(a => a.giver !== a.recipient))
  assert.ok(result.participants.every(p => p.joined_at && !p.claim_code))
  assert.equal(result.activity.filter(a => a.action === 'Participant joined').length, roster.length)
  assert.equal(result.activity.filter(a => a.action === 'Draw finalized').length, 1)
  await assert.rejects(admin('draw', id), /already final/)
  await assert.rejects(admin('add', id, { name: 'Late' }), /already final/)
  await assert.rejects(admin('remove', id, { participant_id: roster[0].id }), /already final/)
  assert.deepEqual((await admin('details', id)).assignments, result.assignments)
  const another = await admin('create', null, { ...details, title: 'Another Christmas' })

  await login()
  await assert.rejects(participant(another.invite, tokens[0]), /not recognized/)
  for (const [index, person] of roster.entries()) {
    const expected = result.assignments.find(a => a.giver === person.name).recipient
    assert.deepEqual(await participant(invite, tokens[index]), { name: person.name, recipient: expected })
  }
  const sheets = workbookData(result)
  assert.deepEqual(sheets.map(sheet => sheet.name), ['Participants', 'Assignments', 'Activity'])
  assert.equal(sheets[0].rows.length, roster.length)
  assert.deepEqual(sheets[1].rows, result.assignments.map(a => [a.giver, a.recipient]))
  assert.equal(sheets[2].rows.length, result.activity.length)
  assert.ok(!JSON.stringify(sheets).includes(roster[0].claim_code))
})
