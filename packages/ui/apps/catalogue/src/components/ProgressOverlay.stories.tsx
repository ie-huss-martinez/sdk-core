import { Button, ProgressOverlay } from "@hussmartinez/ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * Progress over the stage while long work runs: the stage behind is inert,
 * and Cancel shows wherever the work can stop (sdk-core ADR 0067).
 */
const meta = { title: "Components/ProgressOverlay" } satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const stage = {
  display: "grid",
  placeItems: "center",
  blockSize: "18rem",
  background: "var(--hm-color-surface-sunken)",
} as const;

function Stage() {
  return (
    <div style={stage}>
      <Button>Rotate</Button>
    </div>
  );
}

/** A known amount, with a line of detail and Cancel. */
export const Determinate: Story = {
  render: () => (
    <ProgressOverlay
      open
      title="Exporting"
      detail="Encoding on this device…"
      value={40}
      onCancel={() => {}}
    >
      <Stage />
    </ProgressOverlay>
  ),
};

/** An unknown amount, which can't be cancelled. */
export const Indeterminate: Story = {
  render: () => (
    <ProgressOverlay open title="Opening holiday.jpg">
      <Stage />
    </ProgressOverlay>
  ),
};
