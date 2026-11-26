import { Button, type IconComponent } from "@hussmartinez/ui/react";
import { type ReactNode, useId } from "react";
import { usePdfMessages } from "../hooks.js";

/**
 * One of Easy mode's start cards (sdk-core ADR 0067): a task, and the tools
 * it leads to.
 */
export interface StartCard {
  readonly id: "rotate" | "remove" | "add" | "reorder";
  readonly icon: string;
  /** Its tools, by id. The panel lists them in Easy mode too, and the first takes focus. */
  readonly tools: readonly string[];
  /** Whether choosing it runs its first tool, rather than leading to it. */
  readonly run?: boolean;
}

/**
 * The PDF editor's cards (the redesign's draft spec, §5). Only adding pages
 * runs its tool: it asks for a file, which changes nothing until one is
 * chosen. The others lead to their tools, because they act on the pages
 * the person selects.
 */
export const START_CARDS: readonly StartCard[] = [
  { id: "rotate", icon: "rotate-right", tools: ["pdf.rotate-left", "pdf.rotate-right"] },
  { id: "remove", icon: "delete", tools: ["pdf.delete-pages"] },
  { id: "add", icon: "page-add", tools: ["pdf.insert-pages"], run: true },
  { id: "reorder", icon: "move-up", tools: ["pdf.move-earlier", "pdf.move-later"] },
];

/**
 * "What would you like to do?" over the stage, once a PDF is open in Easy
 * mode: shortcuts into the editor, not a wizard. Every card and "Just show
 * me the editor" close them, and nothing behind them is locked: the tools
 * panel and the top bar stay usable.
 */
export function StartCards(props: {
  readonly cards: readonly StartCard[];
  readonly icons: Readonly<Record<string, IconComponent>>;
  readonly onChoose: (card: StartCard) => void;
  readonly onSkip: () => void;
}): ReactNode {
  const messages = usePdfMessages();
  const t = messages.t as (key: string) => string;
  const titleId = useId();
  return (
    <section className="hm-pdf-start" aria-labelledby={titleId}>
      <ol className="hm-pdf-start-steps" aria-label={t("start.steps")}>
        <li className="hm-pdf-start-step">{t("start.step.open")}</li>
        <li className="hm-pdf-start-step" aria-current="step">
          {t("start.step.edit")}
        </li>
        <li className="hm-pdf-start-step">{t("start.step.download")}</li>
      </ol>
      {/* The region's name, not a heading: the editor renders no headings in
          the host's page, so it needs no heading level (sdk-core ADR 0058). */}
      <p className="hm-pdf-start-heading" id={titleId}>
        {t("start.title")}
      </p>
      <ul className="hm-pdf-start-cards">
        {props.cards.map((card) => {
          const Icon = props.icons[card.icon];
          return (
            <li key={card.id}>
              <button
                type="button"
                className="hm-pdf-start-card"
                data-hm-card={card.id}
                onClick={() => props.onChoose(card)}
              >
                <span className="hm-pdf-start-card-icon" aria-hidden="true">
                  {Icon ? <Icon /> : null}
                </span>
                <span className="hm-pdf-start-card-title">{t(`start.${card.id}`)}</span>{" "}
                <span className="hm-pdf-start-card-description">
                  {t(`start.${card.id}.description`)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button variant="quiet" className="hm-pdf-start-skip" onClick={props.onSkip}>
        {t("start.skip")}
      </Button>
    </section>
  );
}
