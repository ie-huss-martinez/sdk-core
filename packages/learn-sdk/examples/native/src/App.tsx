import {
  type AsyncProgressStorage,
  arabicProfile,
  createAsyncProgressStore,
  createExerciseTypes,
  createFsrsScheduler,
  createRecallType,
  DEFAULT_MATCH_DISTANCE,
  dueItems,
  expectedTaps,
  matchTolerantly,
  type RecallPayload,
  type SequenceRecallPayload,
  sequenceRecall,
  spanishProfile,
} from "@hussmartinez/learn-sdk";
import { type LearnPlayerSession, useLearnPlayer } from "@hussmartinez/learn-sdk/native";
import {
  announce,
  Button,
  ChoiceList,
  Dir,
  NativeUiProvider,
  NoFlip,
  Text,
  useNativeTheme,
} from "@hussmartinez/ui/native";
import { type ReactElement, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

/**
 * learn-sdk on React Native, as an application would use it: the build of
 * this application is the test (sdk-core ADR 0069). Metro must resolve both
 * packages' ESM-only `exports`, and Hermes must compile them, ts-fsrs
 * included.
 */

/**
 * AsyncStorage's shape, kept in memory here so the example needs no storage
 * package. An application passes `AsyncStorage` itself.
 */
const values = new Map<string, string>();
const storage: AsyncProgressStorage = {
  getItem: async (key) => values.get(key) ?? null,
  setItem: async (key, value) => void values.set(key, value),
  removeItem: async (key) => void values.delete(key),
};

// Made once, outside the component: a new one would start a new session.
const types = createExerciseTypes([
  createRecallType({ tolerance: DEFAULT_MATCH_DISTANCE }),
  sequenceRecall,
]);
const progressStore = createAsyncProgressStore({ namespace: "example", storage });
const scheduler = createFsrsScheduler();
const SCOPE = "learner-1";

const content = {
  format: "hm-learn-content",
  version: 1,
  exercises: [
    {
      id: "vault",
      type: "recall",
      payload: {
        items: [
          {
            id: "vault:keys",
            cue: "¿Dónde están las llaves?",
            answers: ["En el cajón"],
            choices: ["En el cajón", "En la mesa", "En el coche"],
          },
        ],
      },
    },
    { id: "path", type: "sequence-recall", payload: { tiles: 9, sequence: [4, 0, 7] } },
  ],
};

function Recall({ session }: { session: LearnPlayerSession }): ReactElement | null {
  const { player, current } = session;
  if (!player || !current) {
    return null;
  }
  const [item] = (current.exercise.payload as RecallPayload).items;
  if (!item) {
    return null;
  }
  const picked = (current.draft as { recalled?: (string | null)[] } | undefined)?.recalled?.[0];
  return (
    <View style={{ gap: 12 }}>
      <Text variant="title" accessibilityRole="header">
        {item.cue}
      </Text>
      <ChoiceList
        accessibilityLabel={item.cue}
        choices={(item.choices ?? []).map((choice) => ({ key: choice, label: choice }))}
        value={picked ?? null}
        {...(current.status === "checked" && item.answers[0]
          ? { correctKey: item.answers[0] }
          : {})}
        feedbackLabels={{ correct: "correcta", hint: "tu respuesta" }}
        onValueChange={(choice) => {
          player.answer({ recalled: [choice] });
          player.check();
          const { match } = matchTolerantly(choice, item.answers, { profile: spanishProfile });
          announce(match ? "Correcto" : `Era: ${item.answers[0]}`);
        }}
      />
    </View>
  );
}

function Sequence({ session }: { session: LearnPlayerSession }): ReactElement | null {
  const theme = useNativeTheme();
  const { player, current } = session;
  if (!player || !current) {
    return null;
  }
  const payload = current.exercise.payload as SequenceRecallPayload;
  const taps = (current.draft as { taps?: number[] } | undefined)?.taps ?? [];
  const wanted = expectedTaps(payload);
  return (
    // A board is a physical layout: it never mirrors.
    <NoFlip style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {Array.from({ length: payload.tiles }, (_, tile) => (
        <Pressable
          // biome-ignore lint/suspicious/noArrayIndexKey: a board's tiles never change order.
          key={tile}
          accessibilityRole="button"
          accessibilityLabel={`${tile + 1}`}
          disabled={current.status !== "answering" || taps.length >= wanted.length}
          onPress={() => {
            const next = [...taps, tile];
            player.answer({ taps: next });
            if (next.length === wanted.length) {
              player.check();
            }
          }}
          style={{
            width: theme.tokens["control-height-large"],
            height: theme.tokens["control-height-large"],
            borderRadius: theme.tokens["radius-control"],
            backgroundColor: taps.includes(tile)
              ? theme.tokens["color-accent"]
              : theme.tokens["color-control"],
          }}
        />
      ))}
    </NoFlip>
  );
}

function Player(): ReactElement {
  const [dueCount, setDueCount] = useState(0);
  const session = useLearnPlayer({
    content,
    types,
    profile: spanishProfile,
    progressStore,
    scope: SCOPE,
    scheduler,
    onProgress: () => {
      void progressStore
        .load(SCOPE)
        .then((progress) => setDueCount(dueItems(progress, Date.now() + 30 * 86_400_000).length));
    },
  });
  const { player, current, snapshot, error } = session;
  if (!player || !current || !snapshot) {
    return <Text tone="danger">{String(error)}</Text>;
  }
  return (
    <View style={{ gap: 20 }}>
      {current.exercise.type === "recall" ? (
        <Recall session={session} />
      ) : (
        <Sequence session={session} />
      )}
      {current.grade ? (
        <Text tone={current.grade.score === current.grade.max ? "success" : "hint"}>
          {`${current.grade.score} / ${current.grade.max}`}
        </Text>
      ) : null}
      <Button
        variant="primary"
        size="large"
        disabled={!snapshot.can.next && !snapshot.summary}
        onPress={() => (snapshot.summary ? session.restart() : player.next())}
      >
        {snapshot.summary ? "Otra vez" : "Siguiente"}
      </Button>
      <Text variant="small" tone="muted">{`Para repasar en 30 días: ${dueCount}`}</Text>
    </View>
  );
}

export function App(): ReactElement {
  return (
    <NativeUiProvider>
      <Dir locale={spanishProfile.code} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
          <Player />
          {/* A profile says which way its language runs. */}
          <Dir dir={arabicProfile.direction}>
            <Text>{arabicProfile.code}</Text>
          </Dir>
        </ScrollView>
      </Dir>
    </NativeUiProvider>
  );
}
