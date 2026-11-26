import type { EditorMode } from "@hussmartinez/sdk-core";
import {
  IconButton,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "@hussmartinez/ui/react";
import { forwardRef, type ReactNode, useState } from "react";
import { planLength } from "../core/model/plan.js";
import { formatTimecode } from "../core/model/time.js";
import {
  useAudioEditorContext,
  useAudioOutput,
  useAudioPlayhead,
  useAudioSession,
} from "./context.js";
import { tracksText } from "./names.js";
import { classes, type PartClassNames } from "./parts.js";

/**
 * Props of {@link AudioTransport}.
 *
 * @public
 */
export interface AudioTransportProps {
  readonly className?: string;
}

/**
 * The editor's transport (docs/adr/0005): play and pause, back to the
 * start, and the time as `0:12.40 / 1:05.00`. When the browser won't start
 * sound, as under an autoplay rule, it says that sound needs a press of
 * Play, next to the button. Inside an {@link AudioEditorProvider}.
 *
 * @public
 */
export function AudioTransport({ className }: AudioTransportProps): ReactNode {
  return <Transport className={className} classNames={undefined} />;
}

/** The transport, with the editor's part classes. Its ref is the play button. */
export const Transport = /* @__PURE__ */ forwardRef<
  HTMLButtonElement,
  {
    readonly className?: string | undefined;
    readonly classNames: PartClassNames | undefined;
    /**
     * The editor's mode, on its frame (docs/adr/0007): play and pause in
     * every mode, and the start and end in Expert. Without one, the
     * building block's play and start.
     */
    readonly mode?: EditorMode | undefined;
  }
>(function Transport({ className, classNames, mode }, ref): ReactNode {
  const { messages } = useAudioEditorContext();
  const { snapshot } = useAudioSession();
  const { output, snapshot: playback } = useAudioOutput();
  const position = useAudioPlayhead();
  const [notice, setNotice] = useState<string>();
  const { plan } = snapshot;
  const length = plan ? planLength(plan) : 0;
  const rate = plan?.sampleRate ?? 1;
  const playing = playback.state === "playing";

  const playPause = () => {
    if (playing) {
      output.pause();
      return;
    }
    setNotice(undefined);
    output.play().catch((error: unknown) => setNotice(messages.error(error)));
  };

  return (
    <section
      className={classes("hm-audio-editor-transport", classNames?.transport, className)}
      aria-label={messages.t("transport.label")}
    >
      <IconButton
        ref={ref}
        variant="primary"
        label={messages.t(playing ? "transport.pause" : "transport.play")}
        icon={playing ? <PauseIcon /> : <PlayIcon />}
        disabled={length === 0}
        focusableWhenDisabled
        onClick={playPause}
      />
      {mode === undefined || mode === "expert" ? (
        <IconButton
          label={messages.t("transport.start")}
          icon={<SkipBackIcon />}
          disabled={length === 0}
          focusableWhenDisabled
          onClick={() => output.seek(0)}
        />
      ) : null}
      {mode === "expert" ? (
        <IconButton
          label={messages.t("tools.end")}
          icon={<SkipForwardIcon />}
          disabled={length === 0}
          focusableWhenDisabled
          onClick={() => output.seek(length)}
        />
      ) : null}
      <p className="hm-audio-editor-time">
        {messages.t("transport.time", {
          position: formatTimecode(Math.min(position, length), rate),
          duration: formatTimecode(length, rate),
        })}
      </p>
      {snapshot.selection && plan ? (
        <p className="hm-audio-editor-selection">
          {messages.t("timeline.selection", {
            start: formatTimecode(snapshot.selection.start, rate),
            end: formatTimecode(snapshot.selection.end, rate),
            tracks: tracksText(
              messages,
              plan,
              plan.tracks.filter((track) => snapshot.selection?.tracks.includes(track.key)),
            ),
          })}
        </p>
      ) : null}
      {notice ? (
        <p className="hm-audio-editor-transport-notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
});
