import { Button, IconButton, Toolbar } from "@hussmartinez/ui/react";
import type { ReactNode } from "react";
import { useNotes } from "../context.js";
import type { NotesPlayback } from "./PageSidebar.js";

export interface RecordingBarProps {
  /** Whether sound is being recorded. */
  readonly recording: boolean;
  /** Whether a stopped recording couldn't be stored yet. */
  readonly unsaved: boolean;
  /** The recording being played, with its number in the notebook's list. */
  readonly playback: (NotesPlayback & { readonly number: number }) | undefined;
  /** Stops the recording and stores it, or stores the one that couldn't be. */
  readonly onStop: () => void;
  readonly onTogglePlayback: () => void;
  readonly onStopPlayback: () => void;
}

/**
 * The recording's transport, in the frame's bottom region (docs/adr/0007,
 * docs/adr/0008): while sound is recorded, Stop; while a recording waits to
 * be stored, the way to store it; and while one plays, play or pause and
 * stop. It shows only while one of them is under way.
 */
export function RecordingBar(props: RecordingBarProps): ReactNode {
  const { messages, icons } = useNotes();
  const { recording, unsaved, playback } = props;
  const Play = icons[playback?.playing ? "pause" : "play"];
  const Stop = icons["stop"];
  const Microphone = icons["microphone"];
  return (
    <Toolbar label={messages.t("toolbar.groups.audio")} className="hm-notes-recording-bar">
      {recording ? (
        <>
          {/* Its start is a toast, which screen readers hear already. */}
          <span className="hm-notes-recording-live">
            <span className="hm-notes-recording-dot" aria-hidden="true">
              {Microphone ? <Microphone /> : null}
            </span>
            {messages.t("recordings.live")}
          </span>
          <Button
            size="small"
            variant="danger"
            className="hm-notes-notebook-recording"
            startIcon={Stop ? <Stop /> : null}
            onClick={props.onStop}
          >
            {messages.t("recordings.stop")}
          </Button>
        </>
      ) : unsaved ? (
        <>
          <span className="hm-notes-notebook-unsaved" role="status">
            {messages.t("recordings.unsaved")}
          </span>
          <Button size="small" onClick={props.onStop}>
            {messages.t("recordings.saveAgain")}
          </Button>
        </>
      ) : null}
      {playback ? (
        <>
          <IconButton
            variant="quiet"
            label={messages.t(playback.playing ? "recordings.pause" : "recordings.play", {
              number: playback.number,
            })}
            icon={Play ? <Play /> : null}
            onClick={props.onTogglePlayback}
          />
          <span className="hm-notes-recording-name">
            {messages.t("recordings.item", { number: playback.number, duration: playback.time })}
          </span>
          <Button size="small" variant="quiet" onClick={props.onStopPlayback}>
            {messages.t("recordings.stopPlayback")}
          </Button>
        </>
      ) : null}
    </Toolbar>
  );
}
