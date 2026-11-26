import { useContext, useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { NativeUiContext } from "./NativeUiProvider.js";

/**
 * Whether to leave animation out: the person's `motion` preference from
 * `NativeUiProvider`, or, when that's `system`, the device's reduce-motion
 * setting, followed as it changes.
 *
 * The device's setting is read after the first render, and until it's known
 * the answer is `true`: an animation that starts late is better than one
 * shown to someone who asked for none.
 *
 * @example
 * ```tsx
 * const reduced = useReducedMotion();
 * const duration = reduced ? 0 : theme.tokens["motion-duration-enter"];
 * ```
 *
 * @public
 */
export function useReducedMotion(): boolean {
  const { motion } = useContext(NativeUiContext);
  const [device, setDevice] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (motion !== "system") {
      return undefined;
    }
    // Whether the first reading still counts: not after the effect ends,
    // and not after a change event, which is newer than a reading that was
    // asked for before it and may arrive after it.
    let awaited = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (enabled) => {
        if (awaited) {
          setDevice(enabled);
        }
      },
      // A platform that can't say keeps the safe answer.
      () => undefined,
    );
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      awaited = false;
      setDevice(enabled);
    });
    return () => {
      awaited = false;
      subscription.remove();
      // Nobody is listening from here on, so what was known may go stale:
      // back in `system`, the answer is the safe one until it's read again.
      setDevice(undefined);
    };
  }, [motion]);
  return motion === "system" ? (device ?? true) : motion === "reduced";
}
