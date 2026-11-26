import { AccessibilityInfo } from "react-native";

/**
 * Has the screen reader say a message, such as the result of an action,
 * without moving focus: VoiceOver on iOS and TalkBack on Android. It does
 * nothing when no screen reader is running.
 *
 * The text is the application's, from its own messages; ui adds none.
 *
 * @param message - What to say, in the interface's language.
 * @public
 */
export function announce(message: string): void {
  if (message !== "") {
    AccessibilityInfo.announceForAccessibility(message);
  }
}
