import { Field, SearchField } from "@hussmartinez/ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * A search box: a native search input in a box styled like the other fields,
 * with a search icon and, while it holds text, a button that clears it
 * (docs/adr/0017). It only holds the text: searching, and saying how many
 * results there are, are the page's.
 */
const meta = {
  title: "Components/SearchField",
  component: SearchField,
  args: { label: "Search guides" },
} satisfies Meta<typeof SearchField>;

export default meta;
type Story = StoryObj<typeof meta>;

const column = { display: "grid", gap: "var(--hm-gap-loose)", maxInlineSize: "24rem" } as const;

/** Empty, with a placeholder, which is a hint and never the field's name. */
export const Default: Story = {
  render: () => (
    <div style={column}>
      <SearchField label="Search guides" placeholder="Describe a symptom" />
    </div>
  ),
};

/** While it holds text, a button clears it and returns focus to the field. */
export const WithText: Story = {
  name: "With text",
  render: () => (
    <div style={column}>
      <SearchField label="Search guides" defaultValue="socket disconnects" />
    </div>
  ),
};

/**
 * `end` shows something after the input, such as the shortcut that focuses
 * the field. The hint is hidden from assistive technology, which gets the
 * shortcut from `aria-keyshortcuts`.
 */
export const WithAShortcutHint: Story = {
  name: "With a shortcut hint",
  render: () => (
    <div style={column}>
      <SearchField
        label="Search guides"
        placeholder="Describe a symptom"
        aria-keyshortcuts="Control+k Meta+k"
        end={
          <span aria-hidden="true" style={{ fontSize: "var(--hm-font-size-small)" }}>
            Ctrl K
          </span>
        }
      />
    </div>
  ),
};

/** In a `Field`, the visible label names it, and the description describes it. */
export const InAField: Story = {
  name: "In a field",
  render: () => (
    <div style={column}>
      <Field label="Search guides" description="By symptom, or paste an error code">
        <SearchField defaultValue="ECONNRESET" />
      </Field>
    </div>
  ),
};

export const Disabled: Story = {
  render: () => (
    <div style={column}>
      <SearchField label="Search guides" defaultValue="cors" disabled />
    </div>
  ),
};

/** Visual styles dropped: the layout, the focus ring around the box and the target sizes remain. */
export const Unstyled: Story = {
  render: () => (
    <div style={column}>
      <SearchField unstyled label="Search guides" defaultValue="cors" />
    </div>
  ),
};
