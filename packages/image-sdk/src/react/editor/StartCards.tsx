import { Button, Heading, type IconComponent } from "@hussmartinez/ui/react";
import { type ReactNode, useId } from "react";
import { useImageMessages } from "../hooks.js";

/**
 * One of Easy mode's start cards (sdk-core ADR 0067): a task, the tool it
 * starts, or the properties it shows.
 */
export interface StartCard {
  readonly id: "crop" | "look" | "hide" | "annotate";
  readonly icon: string;
  /** The tool it runs, by id. */
  readonly tool?: string;
  /** Whether it shows the properties, for the adjustments and filters. */
  readonly properties?: boolean;
}

/** The image editor's cards (the redesign's draft spec, §5). */
export const START_CARDS: readonly StartCard[] = [
  { id: "crop", icon: "crop", tool: "image.crop" },
  { id: "look", icon: "image", properties: true },
  { id: "hide", icon: "redact", tool: "image.redact" },
  { id: "annotate", icon: "text", tool: "image.add-text" },
];

/**
 * "What would you like to do?" over the stage, once an image is open in
 * Easy mode: shortcuts into the editor, not a wizard. Every card and "Just
 * show me the editor" close them, and nothing behind them is locked: the
 * tools panel and the top bar stay usable.
 */
export function StartCards(props: {
  readonly cards: readonly StartCard[];
  readonly icons: Readonly<Record<string, IconComponent>>;
  readonly onChoose: (card: StartCard) => void;
  readonly onSkip: () => void;
}): ReactNode {
  const messages = useImageMessages();
  const t = messages.t as (key: string) => string;
  const titleId = useId();
  return (
    <section className="hm-image-start" aria-labelledby={titleId}>
      <ol className="hm-image-start-steps" aria-label={t("start.steps")}>
        <li className="hm-image-start-step">{t("start.step.open")}</li>
        <li className="hm-image-start-step" aria-current="step">
          {t("start.step.edit")}
        </li>
        <li className="hm-image-start-step">{t("start.step.export")}</li>
      </ol>
      <Heading className="hm-image-start-title" id={titleId}>
        {t("start.title")}
      </Heading>
      <ul className="hm-image-start-cards">
        {props.cards.map((card) => {
          const Icon = props.icons[card.icon];
          return (
            <li key={card.id}>
              <button
                type="button"
                className="hm-image-start-card"
                onClick={() => props.onChoose(card)}
              >
                <span className="hm-image-start-card-icon" aria-hidden="true">
                  {Icon ? <Icon /> : null}
                </span>
                <span className="hm-image-start-card-title">{t(`start.${card.id}`)}</span>{" "}
                <span className="hm-image-start-card-description">
                  {t(`start.${card.id}.description`)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button variant="quiet" className="hm-image-start-skip" onClick={props.onSkip}>
        {t("start.skip")}
      </Button>
    </section>
  );
}
