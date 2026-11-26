import {
  createMessages,
  createShortcutRegistry,
  createToolRegistry,
  type ShortcutRegistry,
  type ToolRegistry,
} from "@hussmartinez/sdk-core";
import { type HeadingLevel, useLatest, usePlatform } from "@hussmartinez/ui/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { LearnError } from "../core/errors/learn-error.js";
import type { LearnLimitOverrides } from "../core/errors/learn-limits.js";
import { createExerciseTypes, type ExerciseTypes } from "../core/model/exercise-type.js";
import { defaultLanguageProfile, type LanguageProfile } from "../core/model/language-profile.js";
import type { ProgressChange } from "../core/model/progress.js";
import type { ProgressStore } from "../core/ports/progress-store.js";
import type { Scheduler } from "../core/ports/scheduler.js";
import {
  createLearnPlayer,
  type LearnPlayer,
  type LearnPlayerEvent,
  type LearnPlayerSnapshot,
} from "../core/session/player.js";
import { GapFillPlayer } from "../features/gap-fill/GapFillPlayer.js";
import { gapFill } from "../features/gap-fill/gap-fill.js";
import { MultipleChoicePlayer } from "../features/multiple-choice/MultipleChoicePlayer.js";
import { multipleChoice } from "../features/multiple-choice/multiple-choice.js";
import type { PlayerBlock } from "../features/player/player-block.js";
import {
  type LearnPlayerMessageOverrides,
  type LearnPlayerMessages,
  playerCatalogue,
} from "../features/player/player-messages.js";
import { type LearnPlayerTool, learnPlayerTools } from "../features/player/player-tools.js";
import { WordOrderPlayer } from "../features/word-order/WordOrderPlayer.js";
import { wordOrder } from "../features/word-order/word-order.js";

const builtInTypes = /* @__PURE__ */ createExerciseTypes([multipleChoice, gapFill, wordOrder]);
const builtInBlocks: Readonly<Record<string, PlayerBlock>> = {
  "multiple-choice": MultipleChoicePlayer,
  "gap-fill": GapFillPlayer,
  "word-order": WordOrderPlayer,
};

/**
 * Props of `LearnPlayer`.
 *
 * @public
 */
export interface LearnPlayerProps {
  /** An `hm-learn-content` document, as JSON text or a value. */
  readonly content: unknown;
  /** The exercise types content may use. Defaults to the built-in ones. */
  readonly types?: ExerciseTypes;
  /** A block per host type, by type name, beside the built-in blocks. */
  readonly blocks?: Readonly<Record<string, PlayerBlock>>;
  /** The learned language: its code and direction, and its answer rules. */
  readonly profile?: LanguageProfile;
  readonly progressStore?: ProgressStore;
  readonly scope?: string;
  readonly scheduler?: Scheduler;
  readonly limits?: LearnLimitOverrides;
  readonly onProgress?: (change: ProgressChange) => void;
  readonly onEvent?: (event: LearnPlayerEvent) => void;
  readonly onError?: (error: LearnError) => void;
  readonly messages?: LearnPlayerMessageOverrides;
  readonly locale?: string;
  readonly className?: string;
  /**
   * The level of the exercise's title, `2` to `6`, so the player fits the
   * page's outline (sdk-core ADR 0058). Defaults to `2`; a page's `<h1>` is
   * the host's. The player renders this one level of headings, and a host's
   * block that renders a `Heading` from `@hussmartinez/ui` gets the level
   * below it. Another value is treated as `2`, with a development warning.
   */
  readonly headingLevel?: HeadingLevel | undefined;
}

interface PlayerContext {
  readonly player: LearnPlayer | null;
  /** The content's error, when it couldn't be read. */
  readonly error: unknown;
  readonly messages: LearnPlayerMessages;
  readonly profile: LanguageProfile;
  readonly blocks: Readonly<Record<string, PlayerBlock>>;
  readonly tools: ToolRegistry<LearnPlayerTool>;
  readonly shortcuts: ShortcutRegistry;
  /** Starts the exercises again, from a new session. */
  readonly reset: () => void;
  /**
   * Set when a reset took focus from inside the player, so the new first
   * exercise takes it: kept by `LearnPlayer`, which the reset doesn't remount.
   */
  readonly refocusRef: { current: boolean };
  /** Tells the host about an error an action caused, such as `INVALID_ANSWER`. */
  readonly reportError: (error: LearnError) => void;
}

const Context = /* @__PURE__ */ createContext<PlayerContext | null>(null);

/**
 * Creates the player's session and shares it with the player's parts.
 *
 * @internal
 */
export function LearnPlayerProvider(
  props: Omit<LearnPlayerProps, "className" | "headingLevel"> & {
    /** Starts a new session: `LearnPlayer` remounts the provider with a new key. */
    readonly reset: () => void;
    readonly refocusRef: { current: boolean };
    readonly children?: ReactNode;
  },
): ReactNode {
  const { content, types, progressStore, scope, scheduler, limits, locale, reset, refocusRef } =
    props;
  // The host's latest callbacks, taken as each render commits, never during it
  // (sdk-core ADR 0063). The session calls them through these stable functions.
  const latest = useLatest(props);
  const onProgress = useCallback(
    (change: ProgressChange) => latest.current.onProgress?.(change),
    [latest],
  );
  const onEvent = useCallback(
    (event: LearnPlayerEvent) => latest.current.onEvent?.(event),
    [latest],
  );
  const onError = useCallback((error: LearnError) => latest.current.onError?.(error), [latest]);
  const profile = props.profile ?? defaultLanguageProfile;

  const session = useMemo((): { player: LearnPlayer | null; error: unknown } => {
    try {
      const player = createLearnPlayer({
        content,
        types: types ?? builtInTypes,
        profile,
        ...(progressStore ? { progressStore } : {}),
        ...(scope === undefined ? {} : { scope }),
        ...(scheduler ? { scheduler } : {}),
        ...(limits ? { limits } : {}),
        onProgress,
        onEvent,
        onError,
      });
      return { player, error: null };
    } catch (error) {
      return { player: null, error };
    }
  }, [
    content,
    types,
    profile,
    progressStore,
    scope,
    scheduler,
    limits,
    onProgress,
    onEvent,
    onError,
  ]);
  useEffect(() => () => session.player?.dispose(), [session]);

  const platform = usePlatform();
  const tools = useMemo(() => createToolRegistry(learnPlayerTools), []);
  const shortcuts = useMemo(
    () => createShortcutRegistry({ platform, tools: tools.tools }),
    [platform, tools],
  );
  const messages = useMemo(
    () =>
      createMessages(playerCatalogue, {
        ...(locale ? { locale } : {}),
        ...(props.messages ? { overrides: props.messages } : {}),
      }),
    [locale, props.messages],
  );
  const blocks = useMemo(() => ({ ...builtInBlocks, ...props.blocks }), [props.blocks]);

  const value = useMemo(
    () => ({
      ...session,
      messages,
      profile,
      blocks,
      tools,
      shortcuts,
      reset,
      refocusRef,
      reportError: onError,
    }),
    [session, messages, profile, blocks, tools, shortcuts, reset, refocusRef, onError],
  );
  return <Context.Provider value={value}>{props.children}</Context.Provider>;
}

/** @internal */
export function usePlayerContext(): PlayerContext {
  const context = useContext(Context);
  if (!context) {
    throw new Error("LearnPlayer's parts must be inside LearnPlayer.");
  }
  return context;
}

const subscribeNothing = () => () => {};

/** The player's snapshot, or `null` while there's no session. @internal */
export function usePlayerSnapshot(player: LearnPlayer | null): LearnPlayerSnapshot | null {
  return useSyncExternalStore(
    player ? player.subscribe : subscribeNothing,
    () => player?.getSnapshot() ?? null,
    () => player?.getSnapshot() ?? null,
  );
}
