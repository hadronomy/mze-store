/**
 * The base corner radius.
 *
 * Larger than a bare rounded corner would want, because the corner is not
 * round — see `cornerGeometry`. A superellipse needs room to read as one; at 4px
 * it is indistinguishable from ordinary rounding.
 */
export const radius = "0.625rem";

/**
 * The corner geometry, not its size. `border-radius` still sets the size.
 *
 * `squircle` is `superellipse(2)` — the curve that reads as considered rather
 * than merely rounded, and the one piece of bespoke geometry the system
 * carries. It degrades in two directions at once, which is why it is safe to
 * apply globally: browsers without `corner-shape` fall back to a plain rounded
 * corner, and any element whose radius resolves to `0` is untouched.
 *
 * Anything that must read as a true circle has to opt back out to `round`; a
 * superellipse at full radius is not a circle.
 */
export const cornerGeometry = "squircle";

/**
 * The frame every product image sits in.
 *
 * A multi-brand catalogue receives images on white, on transparent, and on
 * lifestyle backgrounds, in whatever crop the supplier shot. One fixed aspect,
 * one ground, one padding is what stops a category grid reading as a
 * spreadsheet of borrowed pictures. It applies to every image with no
 * exception, which is also an upload rule for Operators.
 */
export const productImage = {
  aspect: "1 / 1",
  padding: "2rem",
} as const;
