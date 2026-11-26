import {
  announce,
  Button,
  type Choice,
  ChoiceList,
  chevronRightIcon,
  createNativeTheme,
  Dir,
  darkNativeTheme,
  Icon,
  isRTL,
  NativeUiProvider,
  NoFlip,
  nativePreferenceOptions,
  readNativePreferences,
  Text,
  undoIcon,
  useNativeTheme,
  useReducedMotion,
  useTextScale,
} from "@hussmartinez/ui/native";
import { type ReactElement, useState } from "react";
import { ScrollView, View } from "react-native";

/**
 * Every export of `@hussmartinez/ui/native`, used as an application would:
 * the build of this application is the test (sdk-core ADR 0069). Metro must
 * resolve the package's ESM-only `exports`, and Hermes must compile it.
 */

// A custom pair: the built-in dark theme, and a light one with its own accent.
const themes = {
  light: createNativeTheme({
    extends: "light",
    tokens: { "color-accent": "#1f5f5b", "font-size-body": 18 },
  }),
  dark: darkNativeTheme,
};

const CAPITALS: readonly Choice[] = [
  { key: "madrid", label: "Madrid" },
  { key: "lisbon", label: "Lisboa" },
  { key: "cairo", label: "القاهرة" },
];

function Quiz(): ReactElement {
  const theme = useNativeTheme();
  const scale = useTextScale();
  const reduced = useReducedMotion();
  const [round, setRound] = useState(0);
  return (
    <View style={{ gap: theme.tokens["gap-loose"] * scale }}>
      <Text variant="title" accessibilityRole="header">
        Which city is the capital of Spain?
      </Text>
      <ChoiceList
        // A new round starts with nothing picked.
        key={round}
        accessibilityLabel="Which city is the capital of Spain?"
        choices={CAPITALS}
        correctKey="madrid"
        feedbackLabels={{ correct: "correct", hint: "your answer" }}
        onValueChange={(key) => announce(key === "madrid" ? "Correct" : "It was Madrid")}
      />
      <Button
        variant="primary"
        size="large"
        icon={chevronRightIcon}
        onPress={() => setRound((current) => current + 1)}
      >
        Next
      </Button>
      <Text variant="small" tone="muted">
        {reduced ? "Animations are off." : "Animations are on."}
      </Text>
    </View>
  );
}

export function App(): ReactElement {
  const [locale, setLocale] = useState("es");
  const [preferences, setPreferences] = useState(() => readNativePreferences(null));
  const nextScale = () => {
    const steps = nativePreferenceOptions.textScale;
    const next = steps[(steps.indexOf(preferences.textScale) + 1) % steps.length];
    setPreferences(readNativePreferences({ ...preferences, textScale: next }));
  };
  return (
    <NativeUiProvider
      theme={themes}
      colorMode={preferences.theme}
      textScale={preferences.textScale}
      motion={preferences.motion}
    >
      <Dir locale={locale} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
          <Quiz />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            {/* Mirrored when the direction is right to left. */}
            <Icon icon={undoIcon} label="Undo" />
            <Button onPress={() => setLocale(isRTL(locale) ? "es" : "ar")}>
              {isRTL(locale) ? "Español" : "العربية"}
            </Button>
            <Button variant="quiet" onPress={nextScale}>
              Text size
            </Button>
          </View>
          <NoFlip>
            <Text tone="hint">A map or a grid stays as it is in right-to-left text.</Text>
          </NoFlip>
        </ScrollView>
      </Dir>
    </NativeUiProvider>
  );
}
