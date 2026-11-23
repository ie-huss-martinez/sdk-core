import { Button, Dialog, Field, SegmentedControl, TextField } from "@hussmartinez/ui/react";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import type { NotesFolder, NotesNotebookSummary } from "../../core/model/library.js";
import {
  NOTES_PAGE_SIZES,
  type NotesCover,
  type NotesPageSizeName,
  type NotesTemplate,
} from "../../core/model/notebook.js";
import { NOTES_MAX_TITLE_LENGTH } from "../../core/model/portable.js";
import { NOTES_TEMPLATES } from "../../core/model/templates.js";
import type { NotesNewNotebook } from "../../core/session/library.js";
import { useNotes } from "../context.js";

/** The covers a notebook can have, in the order they're offered. */
export const NOTES_COVERS: readonly NotesCover[] = ["blue", "green", "amber", "red", "gray"];

interface DialogBase {
  readonly open: boolean;
  readonly onClose: () => void;
}

export interface NewNotebookDialogProps extends DialogBase {
  readonly onCreate: (notebook: NotesNewNotebook) => void;
}

/** Asks for a new notebook's name, paper, cover and page size. */
export function NewNotebookDialog(props: NewNotebookDialogProps): ReactNode {
  const { messages } = useNotes();
  const t = messages.t as (key: string) => string;
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<NotesTemplate>("lined");
  const [cover, setCover] = useState<NotesCover>("blue");
  const [size, setSize] = useState<NotesPageSizeName>("a4");
  const [upright, setUpright] = useState<"portrait" | "landscape">("portrait");
  const name = useRef<HTMLInputElement>(null);

  const create = (event: FormEvent) => {
    event.preventDefault();
    const page = NOTES_PAGE_SIZES[size];
    props.onCreate({
      title: title.trim() || messages.t("newNotebook.defaultName"),
      template,
      cover,
      size: upright === "portrait" ? page : { width: page.height, height: page.width },
    });
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={messages.t("newNotebook.title")}
      closeLabel={messages.t("dialog.close")}
      initialFocus={name}
    >
      <form className="hm-notes-form" onSubmit={create}>
        <Field label={messages.t("newNotebook.name")}>
          {(control) => (
            <TextField
              {...control}
              ref={name}
              value={title}
              placeholder={messages.t("newNotebook.defaultName")}
              maxLength={NOTES_MAX_TITLE_LENGTH}
              onValueChange={setTitle}
            />
          )}
        </Field>
        <SegmentedControl<NotesTemplate>
          label={messages.t("newNotebook.paper")}
          value={template}
          onValueChange={setTemplate}
          options={NOTES_TEMPLATES.map((value) => ({ value, label: t(`templates.${value}`) }))}
        />
        <SegmentedControl<NotesCover>
          label={messages.t("newNotebook.cover")}
          value={cover}
          onValueChange={setCover}
          options={NOTES_COVERS.map((value) => ({ value, label: t(`covers.${value}`) }))}
        />
        <SegmentedControl<NotesPageSizeName>
          label={messages.t("newNotebook.size")}
          value={size}
          onValueChange={setSize}
          options={[
            { value: "a4", label: messages.t("newNotebook.sizes.a4") },
            { value: "letter", label: messages.t("newNotebook.sizes.letter") },
          ]}
        />
        <SegmentedControl<"portrait" | "landscape">
          label={messages.t("newNotebook.orientation")}
          value={upright}
          onValueChange={setUpright}
          options={[
            { value: "portrait", label: messages.t("newNotebook.portrait") },
            { value: "landscape", label: messages.t("newNotebook.landscape") },
          ]}
        />
        <div className="hm-notes-form-actions">
          <Button variant="quiet" onClick={props.onClose}>
            {messages.t("dialogs.cancel")}
          </Button>
          <Button variant="primary" type="submit">
            {messages.t("newNotebook.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export interface NameDialogProps extends DialogBase {
  readonly title: string;
  readonly label: string;
  readonly action: string;
  readonly initial?: string;
  readonly onSubmit: (name: string) => void;
}

/** Asks for one name: a new folder's, or a folder's new one. */
export function NameDialog(props: NameDialogProps): ReactNode {
  const { messages } = useNotes();
  const [name, setName] = useState(props.initial ?? "");
  const field = useRef<HTMLInputElement>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) props.onSubmit(name.trim());
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      size="small"
      title={props.title}
      closeLabel={messages.t("dialog.close")}
      initialFocus={field}
    >
      <form className="hm-notes-form" onSubmit={submit}>
        <Field label={props.label}>
          {(control) => (
            <TextField
              {...control}
              ref={field}
              value={name}
              maxLength={NOTES_MAX_TITLE_LENGTH}
              onValueChange={setName}
              required
            />
          )}
        </Field>
        <div className="hm-notes-form-actions">
          <Button variant="quiet" onClick={props.onClose}>
            {messages.t("dialogs.cancel")}
          </Button>
          <Button variant="primary" type="submit">
            {props.action}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export interface NotebookDialogProps extends DialogBase {
  readonly notebook: NotesNotebookSummary;
  readonly folders: readonly NotesFolder[];
  readonly onRename: (title: string) => void;
  readonly onCover: (cover: NotesCover) => void;
  readonly onMove: (folder: string | null) => void;
  readonly onDuplicate: () => void;
  readonly onBackup: () => void;
  readonly onExport: () => void;
  readonly onBin: () => void;
}

/** One notebook's settings and actions: its name, cover and folder, and what can be done with it. */
export function NotebookDialog(props: NotebookDialogProps): ReactNode {
  const { messages } = useNotes();
  const t = messages.t as (key: string) => string;
  const { notebook, folders } = props;
  const [title, setTitle] = useState(notebook.title);
  const rename = (event: FormEvent) => {
    event.preventDefault();
    if (title.trim() && title.trim() !== notebook.title) props.onRename(title.trim());
  };
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      title={messages.t("notebookDialog.title")}
      closeLabel={messages.t("dialog.close")}
    >
      <div className="hm-notes-form">
        <form className="hm-notes-form-row" onSubmit={rename}>
          <Field label={messages.t("notebookDialog.name")}>
            {(control) => (
              <TextField
                {...control}
                value={title}
                maxLength={NOTES_MAX_TITLE_LENGTH}
                onValueChange={setTitle}
                required
              />
            )}
          </Field>
          <Button type="submit">{messages.t("notebookDialog.rename")}</Button>
        </form>
        <SegmentedControl<NotesCover>
          label={messages.t("newNotebook.cover")}
          value={notebook.cover}
          onValueChange={props.onCover}
          options={NOTES_COVERS.map((value) => ({ value, label: t(`covers.${value}`) }))}
        />
        <Field label={messages.t("notebookDialog.folder")}>
          {(control) => (
            <select
              {...control}
              className="hm-notes-select"
              value={notebook.folder ?? ""}
              onChange={(event) =>
                props.onMove(event.target.value === "" ? null : event.target.value)
              }
            >
              <option value="">{messages.t("library.top")}</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="hm-notes-form-actions">
          <Button onClick={props.onDuplicate}>{messages.t("notebookDialog.duplicate")}</Button>
          <Button onClick={props.onExport}>{messages.t("notebookDialog.export")}</Button>
          <Button onClick={props.onBackup}>{messages.t("notebookDialog.backup")}</Button>
          <Button variant="danger" onClick={props.onBin}>
            {messages.t("notebookDialog.bin")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export interface ConfirmDialogProps extends DialogBase {
  readonly title: string;
  readonly body: string;
  readonly action: string;
  readonly onConfirm: () => void;
}

/** Asks before something that can't be undone, such as deleting a notebook for good. */
export function ConfirmDialog(props: ConfirmDialogProps): ReactNode {
  const { messages } = useNotes();
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      size="small"
      title={props.title}
      description={props.body}
      closeLabel={messages.t("dialog.close")}
      footer={
        <>
          <Button variant="quiet" onClick={props.onClose}>
            {messages.t("dialogs.cancel")}
          </Button>
          <Button variant="danger" onClick={props.onConfirm}>
            {props.action}
          </Button>
        </>
      }
    />
  );
}
