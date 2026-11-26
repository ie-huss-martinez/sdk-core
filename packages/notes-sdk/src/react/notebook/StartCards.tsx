import { Button, Heading, type IconComponent } from "@hussmartinez/ui/react";
import { type ReactNode, useId } from "react";
import { useNotes } from "../context.js";

/**
 * One of Easy mode's start cards (sdk-core ADR 0067, docs/adr/0008): a task,
 * and the tool it puts in hand, or the PDF it asks for.
 */
export interface StartCard {
  readonly id: "write" | "type" | "pdf" | "record";
  readonly icon: string;
  /** The tool it runs, by id. */
  readonly tool?: string;
  /** Whether it asks for a PDF to open as a new notebook. */
  readonly pdf?: boolean;
  /** Whether it shows the tool's options, for this notebook, in Easy mode. */
  readonly properties?: boolean;
}

/** The notebook's cards (docs/adr/0008). */
export const START_CARDS: readonly StartCard[] = [
  { id: "write", icon: "pen", tool: "notes.pen", properties: true },
  { id: "type", icon: "text", tool: "notes.text", properties: true },
  { id: "pdf", icon: "upload", pdf: true },
  { id: "record", icon: "microphone", tool: "notes.record" },
];

/**
 * "What would you like to do?" over an empty notebook, in Easy mode:
 * shortcuts into the notebook, never a wizard. Every card and "Just show me
 * the notebook" close them, and nothing behind them is locked: the tools and
 * the top bar stay usable.
 */
export function StartCards(props: {
  readonly cards: readonly StartCard[];
  readonly icons: Readonly<Record<string, IconComponent>>;
  readonly onChoose: (card: StartCard) => void;
  readonly onSkip: () => void;
}): ReactNode {
  const { messages } = useNotes();
  const t = messages.t as (key: string) => string;
  const titleId = useId();
  return (
    <section className="hm-notes-start" aria-labelledby={titleId}>
      <Heading className="hm-notes-start-title" id={titleId}>
        {t("start.title")}
      </Heading>
      <ul className="hm-notes-start-cards">
        {props.cards.map((card) => {
          const Icon = props.icons[card.icon];
          return (
            <li key={card.id}>
              <button
                type="button"
                className="hm-notes-start-card"
                onClick={() => props.onChoose(card)}
              >
                <span className="hm-notes-start-card-icon" aria-hidden="true">
                  {Icon ? <Icon /> : null}
                </span>
                <span className="hm-notes-start-card-title">{t(`start.${card.id}`)}</span>{" "}
                <span className="hm-notes-start-card-description">
                  {t(`start.${card.id}.description`)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Button variant="quiet" className="hm-notes-start-skip" onClick={props.onSkip}>
        {t("start.skip")}
      </Button>
    </section>
  );
}
