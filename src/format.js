export const uuidPattern = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
export function eventDate(date) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeZone: 'UTC' })
    .format(new Date(date + 'T00:00:00Z'))
}
