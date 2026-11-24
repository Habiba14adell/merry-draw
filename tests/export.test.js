import assert from 'node:assert/strict'
import { test } from 'node:test'
import ExcelJS from 'exceljs'
import { createExchangeWorkbook } from '../src/export.js'

test('Excel workbook is readable and writes names as plain text', async () => {
  const date = '2026-12-01T12:00:00+02:00'
  const bytes = await createExchangeWorkbook({
    participants: [{ name: '=1+1', joined_at: date, claim_code: 'private-code' }],
    assignments: [{ giver: '=1+1', recipient: 'Blair' }],
    activity: [{ action: 'Draw finalized', occurred_at: date }],
  })
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(bytes)
  assert.deepEqual(book.worksheets.map(sheet => sheet.name), ['Participants', 'Assignments', 'Activity'])
  assert.deepEqual(book.getWorksheet('Participants').getRow(2).values.slice(1),
    ['=1+1', 'Joined', '2026-12-01T10:00:00.000Z'])
  assert.deepEqual(book.getWorksheet('Assignments').getRow(2).values.slice(1), ['=1+1', 'Blair'])
  assert.equal(book.getWorksheet('Activity').getCell('A2').value, 'Draw finalized')
})
