import { Button } from "@hussmartinez/ui/react";
import { type ReactNode, useId } from "react";
import { useAudioEditorContext } from "../context.js";
import { ICONS } from "../icons.js";

/**
 * One of Easy mode's start cards (sdk-core ADR 0067): a task, and the tools
 * it leads to.
 */
export interface StartCard {
  readonly id: "trim" | "remove" | "fade" | "combine";
  readonly icon: string;
  /** Its tools, by id. The panel lists them in Easy mode too, and the first that can run takes focus. */
  readonly tools: readonly string[];
  /** Whether choosing it runs its first tool, rather than leading to it. */
  readonly run?: boolean;
  /** Whether it shows the properties in Easy mode, for this recording only. */
  readonly properties?: boolean;
}

/**
 * The audio editor's cards (the redesign's draft spec, §5). Only combining
 * runs its tool: it asks for a file, which changes nothing until one is
 * chosen. The others lead to their tools, which act on the playhead, the
 * selected clip and the selected time. Fading also shows the properties,
 * where a fade's length is set.
 */
export const START_CARDS: readonly StartCard[] = [
  { id: "trim", icon: "trim-start", tools: ["audio.trim-start", "audio.trim-end"] },
  { id: "remove", icon: "delete", tools: ["audio.delete", "audio.split"] },
  {
    id: "fade",
    icon: "fade-in",
    tools: ["audio.fade-in", "audio.fade-out"],
    properties: true,
  },
  { id: "combine", icon: "upload", tools: ["audio.insert"], run: true },
];

/**
 * "What would you like to do?" over the stage, once a recording is open in
 * Easy mode: shortcuts into the editor, not a wizard. Every card and "Just
 * show me the editor" close them, and nothing behind them is locked: the
 * tools, the top bar and the transport stay usable.
 */
export function StartCards(props: {
  readonly cards: readonly StartCard[];
  readonly onChoose: (card: StartCard) => void;
  readonly onSkip: () => void;
}): ReactNode {
  const { messages } = useAudioEditorContext();
  const t = messages.t as (key: string) => string;
  const titleId = useId();
  return (
    <section className="hm-audio-start" aria-labelledby={titleId}>
      <ol className="hm-audio-start-steps" aria-label={t("start.steps")}>
        <li className="hm-audio-start-step">{t("start.step.open")}</li>
        <li className="hm-audio-start-step" aria-current="step">
          {t("start.step.edit")}
        </li>
        <li className="hm-audio-start-step">{t("start.step.export")}</li>
      </ol>
      {/* The region's name, not a heading: the inspector's heading takes the
          host's level, and this would need one of its own (sdk-core ADR 0058). */}
      <p className="hm-audio-start-heading" id={titleId}>
        {t("start.title")}
      </p>
      <ul className="hm-audio-start-cards">
        {props.cards.map((card) => {
          const Icon = ICONS[card.icon];
          return (
            <li key={card.id}>
              <button
                type="button"
                className="hm-audio-start-card"
                data-hm-card={card.id}
                onClick={() => props.onChoose(card)}
              >
                <span className="hm-audio-start-card-icon" aria-hidden="true">
                  {Icon ? <Icon /> : null}
                </span>
                <span className="hm-audio-start-card-title">{t(`start.${card.id}`)}</span>{" "}
                <span className="hm-audio-start-card-description">
                  {t(`start.${card.id}.description`)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button variant="quiet" className="hm-audio-start-skip" onClick={props.onSkip}>
        {t("start.skip")}
      </Button>
    </section>
  );
}
