---
"@hussmartinez/ui": patch
---

Add `@hussmartinez/ui/native`, an entry for React Native. The web entries are unchanged.

- **Themes:** `lightNativeTheme` and `darkNativeTheme` hold every semantic token under the web's name, resolved to native values when `ui` is built: hex colours, density-independent pixels, milliseconds. `createNativeTheme({ extends, tokens })` makes your own. Three hint colours, for a gentle "look again" that is never the danger colour, and a 64 dp `control-height-large` are native only.
- **Components:** `NativeUiProvider`, `Text`, `Button` with a `large` 64 dp size, and `ChoiceList`, which shows the right answer in the success colours and a wrong pick in the hint colours.
- **Icons:** every icon as plain data, such as `undoIcon`, and `Icon`, which draws it with `react-native-svg` and mirrors directional icons in right-to-left content.
- **Direction:** `isRTL(locale)`, which uses no `Intl`, `Dir`, `NoFlip` and `useDirection`.
- **Preferences and accessibility:** `readNativePreferences`, `nativePreferenceOptions`, `useTextScale`, `useReducedMotion` and `announce`.

`react-native` (`>=0.81`) and `react-native-svg` (`>=15`) are new optional peer dependencies: only an application that imports `@hussmartinez/ui/native` needs them. ui's own checks build one configuration inside those ranges, Expo SDK 58 with React Native 0.88.1 and `react-native-svg` 15.16.0. Earlier versions the ranges accept, such as Expo SDK 57 with React Native 0.86, aren't built there. React Native 0.81 is the floor because `Pressable` reports focus from that version, which `Button` needs to show it.
