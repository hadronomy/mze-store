/**
 * Three durations. Anything a component needs is one of these.
 *
 * Every consumer must gate its motion behind `prefers-reduced-motion`. The
 * token says how long, never whether.
 */
export const duration = {
  /** State change on an element already under the pointer. */
  fast: "120ms",
  /** The default: a panel, a menu, a disclosure. */
  base: "200ms",
  /** Something entering that the Shopper was not looking at yet. */
  slow: "320ms",
} as const;

/** Two curves. Entrances decelerate into place; exits accelerate away. */
export const easing = {
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  exit: "cubic-bezier(0.4, 0, 1, 1)",
} as const;
