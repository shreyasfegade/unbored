import type { Transition } from "framer-motion";

export const springSnappy: Transition = {
  stiffness: 500,
  damping: 35,
  mass: 0.5,
};

export const springCrisp: Transition = {
  stiffness: 400,
  damping: 30,
  mass: 0.6,
};

export const springBouncy: Transition = {
  stiffness: 300,
  damping: 20,
  mass: 0.8,
};

export const springHeavy: Transition = {
  stiffness: 200,
  damping: 25,
  mass: 1.2,
};

export const springGentle: Transition = {
  stiffness: 170,
  damping: 26,
  mass: 1,
};

export const easyEnter: Transition = {
  duration: 0.3,
  ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number],
};

export const easyExit: Transition = {
  duration: 0.2,
  ease: [0.55, 0, 1, 0.45] as [number, number, number, number],
};

export const easeOutExpo: Transition = {
  duration: 0.4,
  ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
};

export const easeOutQuint: Transition = {
  duration: 0.35,
  ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
};
