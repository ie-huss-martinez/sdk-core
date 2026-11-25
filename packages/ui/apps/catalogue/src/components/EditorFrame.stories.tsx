import {
  Button,
  CropIcon,
  DownloadIcon,
  EditorFrame,
  type EditorFramePropertiesState,
  type EditorFrameToolsState,
  FlipHorizontalIcon,
  IconButton,
  ModeSwitch,
  RedactIcon,
  RedoIcon,
  RotateLeftIcon,
  RotateRightIcon,
  SettingsIcon,
  Slider,
  TabBar,
  TextIcon,
  ThemeToggle,
  Toolbar,
  ToolList,
  UndoIcon,
} from "@hussmartinez/ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

/**
 * The layout every editor renders through: a top bar, a tools panel that's
 * full, icons only or hidden, the stage, a properties panel and a bottom
 * region. The top bar starts with the tools' toggle and ends with the
 * properties' toggle, one control for each panel. Its sizes follow the
 * frame's own width, so a narrow frame floats its tools, and a phone-sized
 * one swaps them for a tab bar. `Ctrl+\` hides and shows the tools while
 * focus is in the frame.
 */
const meta = {
  title: "Layout/EditorFrame",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const groups = [
  {
    id: "orientation",
    label: "Orientation",
    items: [
      {
        id: "rotate-left",
        label: "Rotate left",
        description: "A quarter turn anticlockwise",
        icon: <RotateLeftIcon />,
        shortcut: "[",
      },
      {
        id: "rotate-right",
        label: "Rotate right",
        description: "A quarter turn clockwise",
        icon: <RotateRightIcon />,
        shortcut: "]",
      },
      {
        id: "flip",
        label: "Flip",
        description: "Mirror it side to side",
        icon: <FlipHorizontalIcon />,
      },
    ],
  },
  {
    id: "edit",
    label: "Edit",
    items: [
      {
        id: "crop",
        label: "Crop",
        description: "Cut away the edges",
        icon: <CropIcon />,
        pressed: true,
      },
      { id: "text", label: "Add text", description: "Type on the picture", icon: <TextIcon /> },
      {
        id: "redact",
        label: "Hide something",
        description: "Cover private details",
        icon: <RedactIcon />,
        disabled: true,
      },
    ],
  },
];

function TopBar() {
  const [mode, setMode] = useState<"easy" | "advanced" | "expert">("advanced");
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  return (
    <>
      <strong>holiday.jpg</strong>
      <span style={{ flex: "1 1 auto" }} />
      <ModeSwitch value={mode} onValueChange={setMode} size="small" />
      <Toolbar label="History" unstyled>
        <IconButton variant="quiet" label="Undo" icon={<UndoIcon />} />
        <IconButton
          variant="quiet"
          label="Redo"
          icon={<RedoIcon />}
          disabled
          focusableWhenDisabled
        />
      </Toolbar>
      <ThemeToggle value={theme} onValueChange={setTheme} />
      <IconButton variant="quiet" label="Settings" icon={<SettingsIcon />} />
      <Button variant="primary" startIcon={<DownloadIcon />}>
        Export
      </Button>
    </>
  );
}

function Example({
  width = "62rem",
  tools: initialTools = "full",
  properties: initialProperties = "shown",
  layout = "sidebar",
  tabBar = false,
  descriptions = false,
}: {
  width?: string;
  tools?: EditorFrameToolsState;
  properties?: EditorFramePropertiesState;
  layout?: "sidebar" | "dock";
  tabBar?: boolean;
  descriptions?: boolean;
}) {
  const [tools, setTools] = useState(initialTools);
  const [properties, setProperties] = useState(initialProperties);
  const [tab, setTab] = useState<string | null>(null);
  const [brightness, setBrightness] = useState(40);
  return (
    <div style={{ blockSize: "30rem", inlineSize: width, maxInlineSize: "100%" }}>
      <EditorFrame
        topBar={<TopBar />}
        tools={
          <ToolList
            label="Image tools"
            groups={groups}
            onRun={() => {}}
            descriptions={descriptions}
          />
        }
        properties={<Slider label="Brightness" value={brightness} onValueChange={setBrightness} />}
        tabBar={
          tabBar ? (
            <TabBar
              label="Tool groups"
              items={groups.map((group) => ({
                id: group.id,
                label: group.label,
                icon: group.items[0]?.icon,
              }))}
              value={tab}
              onValueChange={setTab}
            />
          ) : undefined
        }
        toolsState={tools}
        onToolsStateChange={setTools}
        propertiesState={properties}
        onPropertiesStateChange={setProperties}
        toolsLayout={layout}
      >
        <div style={{ display: "grid", flex: "1 1 auto", placeItems: "center" }}>Stage</div>
      </EditorFrame>
    </div>
  );
}

/** Easy mode's full rows: each tool with a one-line description. */
export const Default: Story = { render: () => <Example descriptions /> };

/** Tools as icons, and the properties hidden behind an edge tab. */
export const Icons: Story = { render: () => <Example tools="icons" properties="hidden" /> };

/** The tools float as a dock over the foot of the stage. */
export const Dock: Story = { render: () => <Example layout="dock" properties="hidden" /> };

/** A phone-sized frame: the tab bar replaces the tools. */
export const Narrow: Story = { render: () => <Example width="24rem" tabBar properties="hidden" /> };
