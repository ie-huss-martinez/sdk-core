import {
  type ComponentRef,
  type ForwardedRef,
  type ForwardRefExoticComponent,
  forwardRef,
  type ReactElement,
  type RefAttributes,
  useState,
} from "react";
import { View, type ViewProps } from "react-native";
import { Button } from "./Button.js";
import type { ButtonSize } from "./button-style.js";
import { CHOICE_VARIANTS, choiceState } from "./choice-state.js";
import type { IconData } from "./icon-data.js";
import { checkIcon } from "./icons.generated.js";
import { useNativeTheme } from "./NativeUiProvider.js";

/**
 * One choice of a {@link ChoiceList}.
 *
 * @public
 */
export interface Choice {
  /** Identifies the choice. Unique in its list. */
  readonly key: string;
  /** The visible text, which also names the choice to screen readers. */
  readonly label: string;
  /** Before the label: an icon of ui's set, or any element, such as a picture. */
  readonly icon?: IconData | ReactElement | undefined;
}

/**
 * Props of {@link ChoiceList}. View props pass through to the list.
 *
 * @public
 */
export interface ChoiceListProps extends Omit<ViewProps, "children"> {
  readonly choices: readonly Choice[];
  /** The picked choice's key, or `null`, when the application keeps it. */
  readonly value?: string | null | undefined;
  /** The pick to start with, when the list keeps it. */
  readonly defaultValue?: string | null | undefined;
  /** Called with the key of the choice a person picks. */
  readonly onValueChange?: ((key: string) => void) | undefined;
  /**
   * The right choice's key, for a question with one. Once a choice is
   * picked, the list shows the answer: the right choice in the success
   * colours with a check, the pick, if it wasn't right, in the hint
   * colours, and the rest dimmed. The pick can't change after that. Leave
   * it out until you want the answer shown, or altogether for a plain
   * choice.
   */
  readonly correctKey?: string | undefined;
  /**
   * What a screen reader adds to a choice's name when the answer is shown,
   * in the interface's language: `correct` for the right choice, `hint` for
   * a pick that wasn't it, such as "your answer". Without them, the states
   * are only visible, so pass them whenever you pass `correctKey`.
   */
  readonly feedbackLabels?: { readonly correct: string; readonly hint: string } | undefined;
  /** The size of each choice's target. Defaults to `large`, 64 dp. */
  readonly size?: ButtonSize | undefined;
  /** Disables every choice. */
  readonly disabled?: boolean | undefined;
}

/**
 * A list of choices to pick one from, with large targets, as a radio group
 * to screen readers.
 *
 * With `correctKey`, it's an errorless question: a pick that isn't right is
 * shown in the hint colours, never as an error, and the right choice is
 * shown beside it, so the right association is the one that stays in mind.
 *
 * The list has no text of its own: say the result with `announce`, in your
 * own words.
 *
 * @example
 * ```tsx
 * <ChoiceList
 *   accessibilityLabel={question}
 *   choices={choices}
 *   correctKey={answer}
 *   feedbackLabels={{ correct: t("quiz.correct"), hint: t("quiz.yourAnswer") }}
 *   onValueChange={(key) => announce(key === answer ? t("quiz.right") : t("quiz.itWas", { answer }))}
 * />
 * ```
 *
 * @public
 */
export const ChoiceList: ForwardRefExoticComponent<
  ChoiceListProps & RefAttributes<ComponentRef<typeof View>>
> = /* @__PURE__ */ forwardRef(function ChoiceList(
  {
    choices,
    value,
    defaultValue = null,
    onValueChange,
    correctKey,
    feedbackLabels,
    size = "large",
    disabled = false,
    style,
    ...props
  }: ChoiceListProps,
  ref: ForwardedRef<ComponentRef<typeof View>>,
) {
  const theme = useNativeTheme();
  const [own, setOwn] = useState<string | null>(defaultValue);
  const picked = value === undefined ? own : value;
  const answered = picked !== null && correctKey !== undefined;
  return (
    <View
      accessibilityRole="radiogroup"
      {...props}
      ref={ref}
      style={[{ gap: theme.tokens["gap-normal"] }, style]}
    >
      {choices.map((choice) => {
        const state = choiceState(choice.key, picked, correctKey);
        const feedback =
          state === "correct"
            ? feedbackLabels?.correct
            : state === "hint"
              ? feedbackLabels?.hint
              : undefined;
        return (
          <Button
            key={choice.key}
            variant={CHOICE_VARIANTS[state]}
            size={size}
            // The check is the cue that doesn't depend on colour.
            icon={state === "correct" ? checkIcon : choice.icon}
            disabled={disabled || state === "dimmed"}
            accessibilityRole="radio"
            accessibilityLabel={
              feedback === undefined ? choice.label : `${choice.label}, ${feedback}`
            }
            accessibilityState={{ checked: choice.key === picked }}
            onPress={() => {
              // Once the answer is shown, the pick stays.
              if (answered || choice.key === picked) {
                return;
              }
              setOwn(choice.key);
              onValueChange?.(choice.key);
            }}
          >
            {choice.label}
          </Button>
        );
      })}
    </View>
  );
});
