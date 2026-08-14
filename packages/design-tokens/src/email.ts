import { color, type ColorName } from "./color";
import { fontStack, textSize } from "./type";

/**
 * The token surface for email templates.
 *
 * Email is the one consumer that can read neither a custom property nor an
 * `oklch()` value, so it gets colours already resolved to sRGB. ADR-0011 keeps
 * the two template sets separate; this module is the part they do share.
 */

/** Every brand colour as an sRGB hex string. */
export const emailColor = Object.fromEntries(
  Object.entries(color).map(([name, value]) => [name, value.hex]),
) as Readonly<Record<ColorName, string>>;

/** The family stacks a mail client can actually resolve. */
export const emailFont = fontStack.email;

/** The same seven type steps. Sizes are surface-independent. */
export const emailTextSize = textSize;
