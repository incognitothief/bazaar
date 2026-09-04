import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Swaps the element at `index` with its neighbor in `direction`; a no-op past either end. */
export function moveArrayItem<T>(arr: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= arr.length) return arr;
  const next = arr.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
