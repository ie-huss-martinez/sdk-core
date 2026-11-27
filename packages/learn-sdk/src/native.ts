/**
 * learn-sdk for React Native: the headless player as hooks, with no DOM, no
 * stylesheet and no text of its own (ADR 0010, sdk-core ADR 0069).
 *
 * @remarks
 * Everything else a native application needs is in the core entry, which
 * runs on Hermes: the exercise types, grading, the language profiles,
 * `dueItems`, and `createAsyncProgressStore` for AsyncStorage. This entry
 * holds only what needs React. It imports nothing from `react-native`
 * itself, and draws nothing: pair it with `@hussmartinez/ui/native`, or
 * your own views.
 *
 * @packageDocumentation
 */

export type { CurrentExercise, LearnPlayerSession } from "./native/use-learn-player.js";
export { useLearnPlayer, usePlayerSnapshot } from "./native/use-learn-player.js";
