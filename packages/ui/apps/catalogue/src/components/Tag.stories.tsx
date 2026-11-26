import {
  CheckIcon,
  InfoIcon,
  SparklesIcon,
  Tag,
  TagList,
  WarningIcon,
} from "@hussmartinez/ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * A short, static label: a category, a technology, a state. It's text, not a
 * control, so it takes no focus and has no hover or pressed state
 * (docs/adr/0015). Colour never says a state on its own: the text does.
 */
const meta = {
  title: "Components/Tag",
  component: Tag,
  args: { children: "Tag" },
} satisfies Meta<typeof Tag>;

export default meta;
type Story = StoryObj<typeof meta>;

const row = {
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--hm-gap-normal)",
} as const;

/** `neutral` is the default. */
export const Tones: Story = {
  render: () => (
    <div style={row}>
      <Tag>Neutral</Tag>
      <Tag tone="accent">Accent</Tag>
      <Tag tone="success">Success</Tag>
      <Tag tone="warning">Warning</Tag>
      <Tag tone="danger">Danger</Tag>
    </div>
  ),
};

/** The icon is decorative: the text carries the meaning. */
export const WithIcons: Story = {
  name: "With icons",
  render: () => (
    <div style={row}>
      <Tag icon={<InfoIcon />}>Draft</Tag>
      <Tag tone="accent" icon={<SparklesIcon />}>
        New
      </Tag>
      <Tag tone="success" icon={<CheckIcon />}>
        Reviewed
      </Tag>
      <Tag tone="warning" icon={<WarningIcon />}>
        Deprecated
      </Tag>
      <Tag tone="danger" icon={<WarningIcon />}>
        Breaking change
      </Tag>
    </div>
  ),
};

/**
 * A `TagList` is a `<ul>` and its tags are its `<li>`s, so a screen reader
 * says how many there are. It wraps, and a tag too long for the line wraps
 * inside itself instead of being cut short.
 */
export const List: Story = {
  render: () => (
    <div style={{ maxInlineSize: "20rem" }}>
      <TagList aria-label="Stack">
        <Tag>React</Tag>
        <Tag>Astro</Tag>
        <Tag>TypeScript</Tag>
        <Tag>PostgreSQL</Tag>
        <Tag>Playwright</Tag>
        <Tag tone="accent">A tag with a label too long for one line of this narrow column</Tag>
      </TagList>
    </div>
  ),
};

/** Visual styles dropped: the layout remains, and the page's own text styles apply. */
export const Unstyled: Story = {
  render: () => (
    <div style={row}>
      <Tag unstyled>Unstyled</Tag>
      <Tag unstyled tone="danger" icon={<WarningIcon />}>
        Unstyled, with an icon
      </Tag>
    </div>
  ),
};
