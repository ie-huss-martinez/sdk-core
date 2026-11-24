import {
  defaultEditorPreferences,
  type EditorPreferences,
  SettingsPanel,
} from "@hussmartinez/ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

/**
 * An editor's settings in a sheet: controlled, so the host decides where
 * they're kept. On a wide viewport it comes from the inline end; on a phone,
 * from the bottom.
 */
const meta = {
  title: "Layout/SettingsPanel",
  parameters: { visual: { capture: "dialog[open]" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function Default() {
    const [open, setOpen] = useState(true);
    const [value, setValue] = useState<EditorPreferences>({
      ...defaultEditorPreferences,
      mode: "advanced",
    });
    return (
      <SettingsPanel open={open} onOpenChange={setOpen} value={value} onValueChange={setValue} />
    );
  },
};
