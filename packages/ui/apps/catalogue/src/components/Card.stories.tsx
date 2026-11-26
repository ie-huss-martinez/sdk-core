import {
  Button,
  Card,
  DeleteIcon,
  Dialog,
  IconButton,
  startMorphTransition,
} from "@hussmartinez/ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { type ReactNode, useRef, useState } from "react";

/**
 * A card for something the user opens (ADR 0014). The link or button in its
 * title covers the whole card, so a click anywhere follows it, with one Tab
 * stop and the focus ring around the card. Buttons and links in the footer
 * keep their own clicks; the rest of the footer, such as tags, follows the
 * main action.
 */
const meta = { title: "Components/Card" } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const grid = {
  display: "grid",
  gap: "var(--hm-gap-loose)",
  gridTemplateColumns: "repeat(auto-fill, minmax(14rem, 1fr))",
  maxInlineSize: "48rem",
} as const;
const text = { margin: 0 } as const;
const tag = {
  border: "var(--hm-border-width) solid var(--hm-color-border)",
  borderRadius: "var(--hm-radius-round)",
  fontSize: "var(--hm-font-size-small)",
  paddingInline: "var(--hm-gap-normal)",
} as const;

function Tags({ names }: { names: readonly string[] }): ReactNode {
  return names.map((name) => (
    <span key={name} style={tag}>
      {name}
    </span>
  ));
}

/** Link cards in a grid: rows stretch, so the footers line up. */
export const Links: Story = {
  render: () => (
    <div style={grid}>
      <Card
        title={<a href="#guide">Fixing a failed export</a>}
        eyebrow="Guide"
        footer={<Tags names={["E_EXPORT", "E_QUOTA"]} />}
      >
        <p style={text}>What each export error means, and what to try first.</p>
      </Card>
      <Card
        title={<a href="#explainer">How pages are cached</a>}
        eyebrow="Explainer"
        footer={<Tags names={["Workers", "IndexedDB"]} />}
      >
        <p style={text}>
          Rendered pages stay in memory while you work, and on disk between sessions, so reopening a
          document is quick.
        </p>
      </Card>
      <Card title={<a href="#practice">Keyboard shortcuts</a>} eyebrow="Practice">
        <p style={text}>12 questions</p>
      </Card>
    </div>
  ),
};

/** Media is read after the title and shown at the top, from edge to edge. */
export const WithMedia: Story = {
  name: "With media",
  render: () => (
    <div style={grid}>
      <Card
        title={<a href="#travel">Travel</a>}
        media={
          <svg
            viewBox="0 0 16 9"
            aria-hidden="true"
            style={{ background: "var(--hm-color-accent-subtle)" }}
          >
            <circle cx="12" cy="3" r="1.5" fill="var(--hm-color-accent)" />
            <path d="M0 9 L5 4 L9 8 L11 6 L16 9 Z" fill="var(--hm-color-accent)" />
          </svg>
        }
      >
        <p style={text}>12 notes</p>
      </Card>
    </div>
  ),
};

/** Footer actions keep their own clicks above the card's main action. */
export const WithActions: Story = {
  name: "With actions",
  render: () => (
    <div style={grid}>
      <Card
        title={<a href="#recipes">Recipes</a>}
        footer={
          <IconButton variant="quiet" size="small" label="Delete Recipes" icon={<DeleteIcon />} />
        }
      >
        <p style={text}>Edited yesterday</p>
      </Card>
    </div>
  ),
};

/** Without ui's visual styles: the layout, the covering action and the focus ring stay. */
export const Unstyled: Story = {
  render: () => (
    <div style={grid}>
      <Card unstyled title={<a href="#plain">Plain</a>} eyebrow="Unstyled">
        <p style={text}>The host styles it.</p>
      </Card>
    </div>
  ),
};

function MorphExample() {
  const card = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div style={grid}>
      <Card
        ref={card}
        eyebrow="Lesson"
        title={
          <button
            type="button"
            onClick={() => {
              void startMorphTransition({ from: card, to: dialog, update: () => setOpen(true) });
            }}
          >
            Fractions
          </button>
        }
      >
        <p style={text}>Halves, thirds and quarters.</p>
      </Card>
      <Dialog
        ref={dialog}
        open={open}
        title="Fractions"
        description="Halves, thirds and quarters."
        onOpenChange={(next) => {
          void startMorphTransition({ from: dialog, to: card, update: () => setOpen(next) });
        }}
        footer={
          <Button
            variant="primary"
            onClick={() => {
              void startMorphTransition({ from: dialog, to: card, update: () => setOpen(false) });
            }}
          >
            Start
          </Button>
        }
      >
        <p style={text}>Eight short questions, about five minutes.</p>
      </Dialog>
    </div>
  );
}

/**
 * The card grows into the dialog it opens, and shrinks back when it closes,
 * through `startMorphTransition` and the browser's view transitions. With
 * reduced motion, the dialog just opens.
 */
export const MorphIntoADialog: Story = {
  name: "Morph into a dialog",
  render: () => <MorphExample />,
};
