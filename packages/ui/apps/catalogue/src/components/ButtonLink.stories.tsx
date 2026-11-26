import {
  ArrowRightIcon,
  Button,
  ButtonLink,
  ExternalLinkIcon,
  MailIcon,
} from "@hussmartinez/ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * A link that looks like a button, for navigation: a native `<a href>`, so
 * it's a link to assistive technology, Enter follows it and Space doesn't
 * (docs/adr/0015). Use a `Button` for an action.
 */
const meta = {
  title: "Components/ButtonLink",
  component: ButtonLink,
  args: { href: "#guides", children: "Guides" },
} satisfies Meta<typeof ButtonLink>;

export default meta;
type Story = StoryObj<typeof meta>;

const row = {
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--hm-gap-normal)",
} as const;

/** The variants and sizes are the button's. */
export const Variants: Story = {
  render: () => (
    <div style={row}>
      <ButtonLink variant="primary" href="#guides">
        Browse the guides
      </ButtonLink>
      <ButtonLink href="#practice">Practice</ButtonLink>
      <ButtonLink variant="quiet" href="#about">
        About
      </ButtonLink>
      <ButtonLink variant="danger" href="#delete-account">
        Delete account
      </ButtonLink>
      <ButtonLink variant="primary" size="small" href="#guides">
        Small
      </ButtonLink>
    </div>
  ),
};

/**
 * Beside a button, a link looks the same and is announced as what it is. A
 * link with `target="_blank"` says that it opens a new tab, in text hidden on
 * screen; show it with an icon too, such as `ExternalLinkIcon`.
 */
export const LinksAndButtons: Story = {
  name: "Links and buttons",
  render: () => (
    <div style={row}>
      <Button>Save</Button>
      <ButtonLink href="#guides" endIcon={<ArrowRightIcon />}>
        Read the guide
      </ButtonLink>
      <ButtonLink href="https://example.com/" target="_blank" endIcon={<ExternalLinkIcon />}>
        Source code
      </ButtonLink>
      <ButtonLink variant="quiet" href="mailto:hello@example.com" startIcon={<MailIcon />}>
        Write to us
      </ButtonLink>
    </div>
  ),
};

/**
 * In right-to-left text, the arrows of links mirror: onwards points left, and
 * out to another site points up and left.
 */
export const RightToLeft: Story = {
  name: "Right to left",
  render: () => (
    <div dir="rtl" style={row}>
      <ButtonLink variant="primary" href="#guides" endIcon={<ArrowRightIcon />}>
        Read the guide
      </ButtonLink>
      <ButtonLink href="https://example.com/" target="_blank" endIcon={<ExternalLinkIcon />}>
        Source code
      </ButtonLink>
    </div>
  ),
};

/** Visual styles dropped: the underline is back, and layout, focus ring and target size remain. */
export const Unstyled: Story = {
  render: () => (
    <div style={row}>
      <ButtonLink unstyled href="#guides">
        Unstyled
      </ButtonLink>
      <ButtonLink unstyled href="#guides" endIcon={<ArrowRightIcon />}>
        Unstyled, with an icon
      </ButtonLink>
    </div>
  ),
};
