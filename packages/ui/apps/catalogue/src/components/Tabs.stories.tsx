import { BookIcon, CodeIcon, Tabs, TimeIcon } from "@hussmartinez/ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Sections of which one shows at a time, chosen from a row of tabs: the
 * WAI-ARIA tabs pattern (docs/adr/0016). Tab reaches the selected tab, the
 * arrow keys, Home and End move between tabs and select, and Tab again
 * reaches the panel. Before JavaScript runs, every panel is shown under a
 * heading instead.
 */
const meta = {
  title: "Components/Tabs",
  component: Tabs,
  args: { label: "Implementations", tabs: [] },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

const text = { margin: 0 } as const;
const column = { maxInlineSize: "32rem" } as const;

const implementations = [
  {
    id: "next",
    label: "Next.js",
    content: <p style={text}>Server Components render on the server, and send no JavaScript.</p>,
  },
  {
    id: "astro",
    label: "Astro",
    content: <p style={text}>Pages are static, with islands that hydrate on their own.</p>,
  },
  {
    id: "remix",
    label: "Remix",
    content: <p style={text}>Loaders fetch on the server before a route renders.</p>,
  },
];

/** The first tab is selected unless `defaultValue` or `value` says otherwise. */
export const Default: Story = {
  render: () => (
    <div style={column}>
      <Tabs label="Implementations" tabs={implementations} />
    </div>
  ),
};

/** Icons are decorative: the label names the tab. */
export const WithIcons: Story = {
  name: "With icons",
  render: () => (
    <div style={column}>
      <Tabs
        label="About this guide"
        defaultValue="code"
        tabs={[
          {
            id: "read",
            label: "Read",
            icon: <BookIcon />,
            content: <p style={text}>The guide.</p>,
          },
          { id: "code", label: "Code", icon: <CodeIcon />, content: <p style={text}>Its code.</p> },
          {
            id: "history",
            label: "History",
            icon: <TimeIcon />,
            content: <p style={text}>How it got here.</p>,
          },
        ]}
      />
    </div>
  ),
};

/** Tabs that don't fit scroll sideways, and focus brings a tab into view. */
export const ManyTabs: Story = {
  name: "Many tabs",
  render: () => (
    <div style={{ maxInlineSize: "20rem" }}>
      <Tabs
        label="Implementations"
        defaultValue="tab-3"
        tabs={Array.from({ length: 8 }, (_, index) => ({
          id: `tab-${index}`,
          label: `Framework ${index + 1}`,
          content: <p style={text}>Panel {index + 1}</p>,
        }))}
      />
    </div>
  ),
};

/**
 * What the server sends, and what a static page that never hydrates keeps:
 * every panel, one after another, each under a heading with its tab's label.
 * Nothing is a tab until the keys work.
 */
export const BeforeJavaScript: Story = {
  name: "Before JavaScript",
  render: () => (
    <div
      style={column}
      // The component's own server markup, as a page without JavaScript has it.
      dangerouslySetInnerHTML={{
        __html: renderToStaticMarkup(
          <Tabs label="Implementations" tabs={implementations} headingLevel={3} />,
        ),
      }}
    />
  ),
};

/** Visual styles dropped: layout, focus rings and target sizes remain. */
export const Unstyled: Story = {
  render: () => (
    <div style={column}>
      <Tabs unstyled label="Implementations" tabs={implementations} />
    </div>
  ),
};
