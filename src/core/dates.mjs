// Даты расписания: день — строка ГГГГММДД.
const fmts = new Map();

// день (ГГГГММДД), на который момент t приходится в часовом поясе tz
export function ymdIn(t, tz) {
  let f = fmts.get(tz);
  if (!f) fmts.set(tz, (f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })));
  return f.format(t).replaceAll('-', '');
}
