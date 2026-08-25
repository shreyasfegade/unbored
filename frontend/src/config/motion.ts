import type { Transition, Variants } from "framer-motion";

/**
 * One shared motion vocabulary for the whole app, so timing and feel are
 * consistent instead of hand-tuned per component.
 *
 * Reduced motion is handled globally by `<MotionConfig reducedMotion>` in
 * App.tsx (which honours both the OS setting and the in-app toggle), so these
 * presets don't each need to branch — framer drops the transforms when asked.
 */

// Signature ease: a confident ease-out. Matches the reveal/wordmark curves.
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const EASE_STANDARD: [number, number, number, number] = [0.25, 0.1, 0.25, 1];

export const DURATION = {
  fast: 0.18,
  base: 0.3,
  slow: 0.45,
} as const;

// Springs, by role.
export const SPRING = {
  // Crisp UI feedback (taps, toggles, nav indicator).
  snappy: { type: "spring", stiffness: 420, damping: 32, mass: 0.7 } as Transition,
  // Elements easing into place (cards, panels).
  gentle: { type: "spring", stiffness: 260, damping: 30 } as Transition,
  // Large / heavy surfaces (page, poster reveal).
  soft: { type: "spring", stiffness: 180, damping: 26 } as Transition,
} as const;

/** Fade up from a small offset — the default entrance for most elements. */
export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE_OUT } },
};

/** A container that staggers its children's entrances. Pair with `fadeRise`
 *  (or any hidden/visible child variant) on the children. */
export const staggerContainer = (stagger = 0.05, delayChildren = 0): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren: stagger, delayChildren } },
});

/** Index-delayed rise, for lists that aren't wrapped in a stagger container. */
export const riseWithIndex = (index: number, step = 0.04): Variants => ({
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { delay: index * step, duration: DURATION.slow, ease: EASE_OUT },
  },
});

/** A tactile hover-lift + press, for any interactive element. Spread onto a
 *  motion element: `{...pressable}`. Framer neutralises it under reduced motion. */
export const pressable = {
  whileHover: { scale: 1.03, y: -2 },
  whileTap: { scale: 0.97, y: 0 },
  transition: SPRING.snappy,
} as const;

/** Same, without the vertical lift — for full-width bars and pills. */
export const pressableFlat = {
  whileHover: { scale: 1.02 },
  whileTap: { scale: 0.97 },
  transition: SPRING.snappy,
} as const;
