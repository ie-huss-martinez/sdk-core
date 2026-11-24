import { addRecentColor, ColorPicker, Field } from "@hussmartinez/ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

const swatches = [
  { value: "#101828", label: "Black" },
  { value: "#ffffff", label: "White" },
  { value: "#d92d20", label: "Red" },
  { value: "#f79009", label: "Orange" },
  { value: "#fdb022", label: "Yellow" },
  { value: "#12b76a", label: "Green" },
  { value: "#1570ef", label: "Blue" },
  { value: "#7a5af8", label: "Purple" },
];

const recentColors = ["#0b2a5c", "#ec4899", "#a9c8fa"];

/**
 * A colour picker: a saturation and brightness area, a hue slider, an
 * optional opacity slider, a hex input, recent colours and swatches. Every
 * axis is a native range input, so screen readers announce each one with
 * the colour's name.
 */
const meta = {
  title: "Components/ColorPicker",
  component: ColorPicker,
  // The area's and strips' gradients are dithered differently on different
  // CPUs, by one level in mixed directions, which the strict comparison
  // refuses (sdk-core ADR 0054). They're masked; everything else is compared.
  parameters: { visual: { mask: [".hm-color-picker-area", ".hm-color-picker-strip"] } },
  args: { label: "Fill", defaultValue: "#1570ef", swatches, recentColors },
} satisfies Meta<typeof ColorPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** In a field, keeping recent colours as the host would. */
export const Default: Story = {
  args: { label: undefined },
  render: function Default(args) {
    const [fill, setFill] = useState("#1570ef");
    const [recent, setRecent] = useState<readonly string[]>(recentColors);
    return (
      <Field label="Fill">
        <ColorPicker
          {...args}
          value={fill}
          onValueChange={setFill}
          onValueCommit={(color) => setRecent((list) => addRecentColor(list, color))}
          recentColors={recent}
        />
      </Field>
    );
  },
};

/** For text: an opacity slider, and the contrast with the background it sits on. */
export const AlphaAndContrast: Story = {
  name: "With opacity and a contrast hint",
  args: { label: "Text colour", alpha: true, defaultValue: "#7a5af8cc", contrastWith: "#ffffff" },
};

/** Swatches, recent colours and the hex input only. */
export const Palette: Story = {
  name: "Palette only",
  args: { variant: "palette" },
};

export const Disabled: Story = {
  args: { disabled: true },
};

/** Visual styles dropped: layout, focus rings, thumbs and target sizes stay. */
export const Unstyled: Story = {
  args: { unstyled: true },
};
