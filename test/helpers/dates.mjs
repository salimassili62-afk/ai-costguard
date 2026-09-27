/**
 * Test dates are computed at run time, never pinned to a literal.
 *
 * The guard warns once per process when a price is older than `PRICING_STALE_AFTER_DAYS`. A test
 * that hardcodes a `lastUpdated` therefore passes today and fails the day the calendar crosses that
 * boundary, usually inside an assertion that has nothing to do with pricing. Tests that need "a
 * fresh price" call `daysAgo(0)`; tests that need "a stale price" call `daysAgo(60)`.
 */

/** An ISO `YYYY-MM-DD` date `days` days before today. */
export function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
