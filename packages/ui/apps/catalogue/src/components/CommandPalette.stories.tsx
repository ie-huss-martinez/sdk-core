import {
  AnnouncerProvider,
  Button,
  CommandPalette,
  type CommandPaletteItem,
  CropIcon,
  FlipHorizontalIcon,
  RedactIcon,
  RotateLeftIcon,
  RotateRightIcon,
  TextIcon,
} from "@hussmartinez/ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

/**
 * A search over an editor's tools, opened with Ctrl+K: an ARIA combobox
 * whose focus stays in the field while the arrow keys move through the
 * results. Every tool is reachable here in every mode (sdk-core ADR 0067).
 */
const meta = {
  title: "Components/CommandPalette",
  // A modal dialog paints in the top layer, outside the story's canvas.
  parameters: { visual: { capture: "dialog[open]" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const items: CommandPaletteItem[] = [
  {
    id: "crop",
    label: "Crop",
    description: "Cut the edges off",
    group: "Image",
    shortcut: "C",
    icon: <CropIcon />,
  },
  {
    id: "rotate-left",
    label: "Rotate left",
    group: "Image",
    shortcut: "[",
    icon: <RotateLeftIcon />,
  },
  {
    id: "rotate-right",
    label: "Rotate right",
    group: "Image",
    shortcut: "]",
    icon: <RotateRightIcon />,
  },
  { id: "flip", label: "Flip horizontally", group: "Image", icon: <FlipHorizontalIcon /> },
  {
    id: "text",
    label: "Add text",
    description: "Type on the image",
    group: "Annotate",
    icon: <TextIcon />,
  },
  {
    id: "redact",
    label: "Redact",
    description: "Hide something private",
    group: "Annotate",
    icon: <RedactIcon />,
    disabled: true,
  },
];

function Example({ list }: { list: CommandPaletteItem[] }) {
  const [open, setOpen] = useState(true);
  const [ran, setRan] = useState("");
  return (
    <AnnouncerProvider>
      <Button onClick={() => setOpen(true)}>Open the command palette</Button>
      <p>{ran}</p>
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        items={list}
        onRun={(id) => setRan(`Ran ${id}`)}
      />
    </AnnouncerProvider>
  );
}

/** Open, with icons, descriptions, groups, shortcuts and a disabled tool. */
export const Default: Story = {
  render: () => <Example list={items} />,
};

/** Plain labels only. */
export const LabelsOnly: Story = {
  name: "Labels only",
  render: () => <Example list={items.map(({ id, label }) => ({ id, label }))} />,
};
