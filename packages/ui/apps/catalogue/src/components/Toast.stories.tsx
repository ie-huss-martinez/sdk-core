import { AnnouncerProvider, Button, ToastProvider, useToast } from "@hussmartinez/ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";

/**
 * Short messages over the foot of the page, with one optional action such
 * as Undo. They never take focus, pause while hovered or focused, and are
 * spoken once through the announcer (sdk-core ADR 0067).
 */
const meta = {
  title: "Components/Toast",
  // The toasts paint in the top layer, outside the story's canvas.
  parameters: { visual: { capture: ".hm-toast-region:popover-open" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Long enough to outlast a screenshot. */
const STAYS = 600_000;

function Shows() {
  const toast = useToast();
  useEffect(() => {
    const ids = [
      toast.show({
        message: "Rotated",
        duration: STAYS,
        action: { label: "Undo", onAction: () => {} },
      }),
      toast.show({ message: "Downloaded · safe to leave", tone: "success", duration: STAYS }),
      toast.show({ message: "This file is larger than 50 MB.", tone: "danger", duration: STAYS }),
    ];
    return () => {
      for (const id of ids) {
        toast.dismiss(id);
      }
    };
  }, [toast]);
  return (
    <Button
      onClick={() =>
        toast.show({ message: "Cropped", action: { label: "Undo", onAction: () => {} } })
      }
    >
      Show a toast
    </Button>
  );
}

/** Neutral with Undo, success, and an error in the danger colour. */
export const Tones: Story = {
  render: () => (
    <AnnouncerProvider>
      <ToastProvider>
        <Shows />
      </ToastProvider>
    </AnnouncerProvider>
  ),
};
