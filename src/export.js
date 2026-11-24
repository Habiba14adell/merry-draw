export function workbookData({ participants, assignments, activity }) {
  return [
    { name: 'Participants', headers: ['Name', 'Status', 'Joined at (UTC)'],
      rows: participants.map(p => [p.name, p.joined_at ? 'Joined' : 'Invited', p.joined_at ? new Date(p.joined_at).toISOString() : '']) },
    { name: 'Assignments', headers: ['Giver', 'Recipient'],
      rows: assignments.map(a => [a.giver, a.recipient]) },
    { name: 'Activity', headers: ['Action', 'Participant', 'Time (UTC)'],
      rows: activity.map(a => [a.action, a.subject ?? '', new Date(a.occurred_at).toISOString()]) },
  ]
}

export async function createExchangeWorkbook(snapshot) {
  const { default: ExcelJS } = await import('exceljs')
  const book = new ExcelJS.Workbook()
  for (const { name, headers, rows } of workbookData(snapshot)) {
    const sheet = book.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
    sheet.addRow(headers).font = { bold: true }
    sheet.addRows(rows)
    sheet.columns.forEach(column => { column.width = 32 })
  }
  return book.xlsx.writeBuffer()
}

export async function exportExchange(snapshot) {
  const bytes = await createExchangeWorkbook(snapshot)
  const url = URL.createObjectURL(new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'merry-draw.xlsx'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
