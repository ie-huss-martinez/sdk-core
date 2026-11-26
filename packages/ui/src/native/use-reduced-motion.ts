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
    let current = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (enabled) => {
        if (current) {
          setDevice(enabled);
        }
      },
      // A platform that can't say keeps the safe answer.
      () => undefined,
    );
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setDevice);
    return () => {
      current = false;
      subscription.remove();
    };
  }, [motion]);
  return motion === "system" ? (device ?? true) : motion === "reduced";
}
