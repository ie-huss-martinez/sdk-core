import { Button } from "@hussmartinez/ui/react";
import { type ReactNode, useId } from "react";
import { useVideoEditor } from "../context.js";
import { ICONS } from "../icons.js";

/**
 * One of Easy mode's start cards (sdk-core ADR 0067): a task, and the tools
 * it leads to.
 */
export interface StartCard {
  readonly id: "cut" | "join" | "remove" | "mute";
  readonly icon: string;
  /** Its tools, by id. The panel lists them in Easy mode too, and the first that can run takes focus. */
  readonly tools: readonly string[];
  /** Whether choosing it runs its first tool, rather than leading to it. */
  readonly run?: boolean;
  /** Whether it shows the properties in Easy mode, for this video only. */
  readonly properties?: boolean;
}

/**
 * The video editor's cards (the redesign's draft spec, §5). Only joining
 * runs its tool: it asks for files, which changes nothing until one is
 * chosen. The others lead to their tools, which act on the playhead and
 * the clips the person selects. Muting also shows the properties, where
 * the selected clips' sound is.
 */
export const START_CARDS: readonly StartCard[] = [
  { id: "cut", icon: "split", tools: ["video.split"] },
  { id: "join", icon: "add", tools: ["video.insert"], run: true },
  { id: "remove", icon: "delete", tools: ["video.delete", "video.split"] },
  { id: "mute", icon: "muted", tools: ["video.mute"], properties: true },
];

/**
 * "What would you like to do?" over the stage, once a video is open in Easy
 * mode: shortcuts into the editor, not a wizard. Every card and "Just show
 * me the editor" close them, and nothing behind them is locked: the tools,
 * the top bar and the timeline stay usable.
 */
export function StartCards(props: {
  readonly cards: readonly StartCard[];
  readonly onChoose: (card: StartCard) => void;
  readonly onSkip: () => void;
}): ReactNode {
  const { messages } = useVideoEditor();
  const t = messages.t as (key: string) => string;
  const titleId = useId();
  return (
    <section className="hm-video-start" aria-labelledby={titleId}>
      <ol className="hm-video-start-steps" aria-label={t("start.steps")}>
        <li className="hm-video-start-step">{t("start.step.open")}</li>
        <li className="hm-video-start-step" aria-current="step">
          {t("start.step.edit")}
        </li>
        <li className="hm-video-start-step">{t("start.step.export")}</li>
      </ol>
      {/* The region's name, not a heading: the editor renders no headings in
          the host's page, so it needs no heading level (sdk-core ADR 0058). */}
      <p className="hm-video-start-heading" id={titleId}>
        {t("start.title")}
      </p>
      <ul className="hm-video-start-cards">
        {props.cards.map((card) => {
          const Icon = ICONS[card.icon];
          return (
            <li key={card.id}>
              <button
                type="button"
                className="hm-video-start-card"
                data-hm-card={card.id}
                onClick={() => props.onChoose(card)}
              >
                <span className="hm-video-start-card-icon" aria-hidden="true">
                  {Icon ? <Icon /> : null}
                </span>
                <span className="hm-video-start-card-title">{t(`start.${card.id}`)}</span>{" "}
                <span className="hm-video-start-card-description">
                  {t(`start.${card.id}.description`)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button variant="quiet" className="hm-video-start-skip" onClick={props.onSkip}>
        {t("start.skip")}
      </Button>
    </section>
  );
}
