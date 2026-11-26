import type { EditorMode } from "@hussmartinez/sdk-core";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  IconButton,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
  ToggleButton,
  useAnnounce,
} from "@hussmartinez/ui/react";
import { type ReactNode, useEffect, useRef } from "react";
import { planFrames } from "../core/model/plan.js";
import { frameTime } from "../core/model/time.js";
import { useVideoEditor, useVideoOutput, useVideoPlayhead, useVideoSession } from "./context.js";
import { formatTimecode } from "./timecode.js";
import { useVideoTools } from "./tools.js";

/**
 * Props of {@link VideoTransport}.
 *
 * @public
 */
export interface VideoTransportProps {
  readonly className?: string;
}

/**
 * Playback controls (docs/adr/0007): play and pause, the previous and next
 * frame, and the time as `position of length`. When the browser kept sound
 * from starting, a notice says how to turn it on, and when the sound
 * couldn't be decoded, a notice says the video plays without it. Each is
 * announced politely when it appears, through the editor's announcer.
 *
 * @public
 */
export function VideoTransport(props: VideoTransportProps): ReactNode {
  return <Transport {...props} />;
}

/**
 * The transport, with its buttons for a mode, as the editor's frame shows
 * it (docs/adr/0010): play and pause in every mode, the previous and next
 * frame from Advanced, and the start and end in Expert. Without a mode, it
 * shows the building block's three.
 *
 * @internal
 */
export function Transport(
  props: VideoTransportProps & { readonly mode?: EditorMode | undefined },
): ReactNode {
  const { messages, locale, tools } = useVideoEditor();
  const { snapshot } = useVideoSession();
  const { output, snapshot: playback } = useVideoOutput();
  const frame = useVideoPlayhead();
  const { ariaKeyShortcuts, labelWithKeys } = useVideoTools();
  /** A tool's shortcuts and tooltip, for the transport's own buttons. */
  const keysOf = (id: string) => ({
    title: labelWithKeys(id),
    "aria-keyshortcuts": ariaKeyShortcuts(id),
  });
  const plan = snapshot.plan;
  const frames = plan ? planFrames(plan) : 0;
  const disabled = !output || frames === 0;
  const playing = playback?.state === "playing";
  const rate = plan?.output.frameRate ?? { num: 30, den: 1 };
  const audio = playback?.audio ?? "ready";
  const note =
    audio === "blocked"
      ? messages.t("transport.audioBlocked")
      : audio === "undecodable"
        ? messages.t("transport.audioUndecodable")
        : null;
  // Announced once each time it appears, through the editor's announcer: a
  // live region that appears with its text isn't announced by every screen
  // reader, so the note itself isn't one.
  const announce = useAnnounce();
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (note && note !== announced.current) announce(note);
    announced.current = note;
  }, [note, announce]);
  const time = messages.t("transport.time", {
    position: formatTimecode(frameTime(frame, rate), locale),
    length: formatTimecode(frameTime(frames, rate), locale),
  });

  const steps = props.mode !== "easy";
  // The start and end are tools of Expert mode's: a host that leaves them
  // out of `tools` gets neither the buttons nor their keys.
  const ends = props.mode === "expert";
  const start = ends && tools.get("video.start") !== undefined;
  const end = ends && tools.get("video.end") !== undefined;
  return (
    <fieldset
      className={["hm-video-transport", props.className].filter(Boolean).join(" ")}
      aria-label={messages.t("transport.label")}
    >
      {start ? (
        <IconButton
          label={messages.t("tools.start")}
          icon={<SkipBackIcon />}
          disabled={disabled}
          {...keysOf("video.start")}
          onClick={() => output?.seek(0)}
        />
      ) : null}
      {steps ? (
        <IconButton
          label={messages.t("transport.previousFrame")}
          icon={<ChevronLeftIcon />}
          disabled={disabled}
          {...keysOf("video.previous-frame")}
          onClick={() => output?.step(-1)}
        />
      ) : null}
      <ToggleButton
        label={messages.t(playing ? "transport.pause" : "transport.play")}
        icon={playing ? <PauseIcon /> : <PlayIcon />}
        pressed={playing}
        disabled={disabled}
        {...keysOf("video.play-pause")}
        onPressedChange={(pressed) => {
          if (!output) return;
          if (pressed) void output.play().catch(() => {});
          else output.pause();
        }}
      />
      {steps ? (
        <IconButton
          label={messages.t("transport.nextFrame")}
          icon={<ChevronRightIcon />}
          disabled={disabled}
          {...keysOf("video.next-frame")}
          onClick={() => output?.step(1)}
        />
      ) : null}
      {end ? (
        <IconButton
          label={messages.t("tools.end")}
          icon={<SkipForwardIcon />}
          disabled={disabled}
          {...keysOf("video.end")}
          onClick={() => output?.seek(Math.max(0, frames - 1))}
        />
      ) : null}
      <span className="hm-video-transport-time" aria-live="off">
        {time}
      </span>
      {note ? <p className="hm-video-transport-note">{note}</p> : null}
    </fieldset>
  );
}
