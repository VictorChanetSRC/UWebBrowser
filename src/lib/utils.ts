import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Confine `n` to `[lo, hi]`. */
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
