import {
  Button,
  IconButton,
  ReorderableList,
  ReorderableListItem,
  SegmentedControl,
  TextField,
} from "@hussmartinez/ui/react";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { NotesOutlineEntry, NotesTemplate } from "../../core/model/notebook.js";
import { NOTES_MAX_TITLE_LENGTH } from "../../core/model/portable.js";
import { NOTES_TEMPLATES } from "../../core/model/templates.js";
import type { NotesSession, NotesSessionSnapshot } from "../../core/session/notebook-session.js";
import type { NotesSearchHit } from "../../core/session/search.js";
import type { ImageCache } from "../canvas/image-cache.js";
import { useNotes } from "../context.js";
import { clipToLength } from "../text.js";
import { PageThumbnail } from "./PageThumbnail.js";
import type { PdfDocuments } from "./pdf-documents.js";

/** The sidebar's views. */
export type SidebarTab = "pages" | "outline" | "search" | "recordings";

/** A recording being played, and how far in it is, in milliseconds. */
export interface NotesPlayback {
  readonly recording: string;
  readonly playing: boolean;
  readonly time: number;
}

export interface PageSidebarProps {
  readonly tab: SidebarTab;
  readonly onTabChange: (tab: SidebarTab) => void;
  readonly session: NotesSession;
  readonly snapshot: NotesSessionSnapshot;
  readonly currentPage: string | undefined;
  readonly images: ImageCache;
  readonly imagesVersion: number;
  readonly documents: PdfDocuments;
  readonly playback: NotesPlayback | undefined;
  readonly onGoToPage: (page: string) => void;
  readonly onAddPage: () => void;
  readonly onDeletePage: (page: string) => void;
  readonly onMovePage: (page: string, toIndex: number) => void;
  readonly onSetTemplate: (page: string, template: NotesTemplate) => void;
  readonly onSetOutline: (outline: readonly NotesOutlineEntry[]) => void;
  readonly onTogglePlayback: (recording: string) => void;
  readonly onDeleteRecording: (recording: string) => void;
  readonly onSearch: (query: string) => Promise<readonly NotesSearchHit[]>;
}

/**
 * The sidebar of an open notebook: its pages as thumbnails, which reorder
 * from the keyboard with Alt and the arrow keys; its outline; a search of
 * typed text and PDF text; and its recordings.
 */
export function PageSidebar(props: PageSidebarProps): ReactNode {
  const { messages, icons } = useNotes();
  const { tab } = props;
  // Four views in a narrow column: each is its icon, with its name for assistive technology.
  const view = (value: SidebarTab, label: string, icon: string) => {
    const Icon = icons[icon];
    return { value, label, hideLabel: true, ...(Icon ? { icon: <Icon /> } : {}) };
  };
  return (
    <aside className="hm-notes-sidebar" aria-label={messages.t("sidebar.label")}>
      <SegmentedControl<SidebarTab>
        label={messages.t("sidebar.views")}
        value={tab}
        onValueChange={props.onTabChange}
        options={[
          view("pages", messages.t("sidebar.pages"), "page-grid"),
          view("outline", messages.t("sidebar.outline"), "bookmark"),
          view("search", messages.t("sidebar.search"), "search"),
          view("recordings", messages.t("sidebar.recordings"), "microphone"),
        ]}
      />
      <div className="hm-notes-sidebar-view">
        {tab === "pages" ? <PagesTab {...props} /> : null}
        {tab === "outline" ? <OutlineTab {...props} /> : null}
        {tab === "search" ? <SearchTab {...props} /> : null}
        {tab === "recordings" ? <RecordingsTab {...props} /> : null}
      </div>
    </aside>
  );
}

function PagesTab(props: PageSidebarProps): ReactNode {
  const { messages, icons } = useNotes();
  const { snapshot, session, currentPage } = props;
  const { pages } = snapshot.notebook;
  const t = messages.t as (key: string) => string;
  const DeleteIcon = icons["delete"];
  const AddIcon = icons["page-add"];
  const current = pages.find((page) => page.id === currentPage);
  return (
    <>
      <ReorderableList
        label={messages.t("pages.label")}
        selectedId={currentPage ?? null}
        onSelectedChange={props.onGoToPage}
        onMove={props.onMovePage}
        {...(pages.length > 1 ? { onRemove: props.onDeletePage } : {})}
      >
        {pages.map((info, index) => (
          <ReorderableListItem
            key={info.id}
            id={info.id}
            label={messages.t("pages.page", { page: index + 1, count: pages.length })}
            classNames={{ item: "hm-notes-thumbnail" }}
            controls={[
              <IconButton
                key="delete"
                size="small"
                variant="quiet"
                label={messages.t("pages.delete", { page: index + 1 })}
                icon={DeleteIcon ? <DeleteIcon /> : null}
                disabled={pages.length < 2}
                focusableWhenDisabled
                onClick={() => props.onDeletePage(info.id)}
              />,
            ]}
          >
            <PageThumbnail
              info={info}
              items={snapshot.pages.get(info.id)?.items}
              images={props.images}
              imagesVersion={props.imagesVersion}
              documents={props.documents}
              onVisible={() => void session.loadPage(info.id).catch(() => undefined)}
            />
            <span className="hm-notes-thumbnail-number">{index + 1}</span>
          </ReorderableListItem>
        ))}
      </ReorderableList>
      <Button size="small" startIcon={AddIcon ? <AddIcon /> : null} onClick={props.onAddPage}>
        {messages.t("pages.add")}
      </Button>
      {current && !current.background ? (
        <SegmentedControl<NotesTemplate>
          label={messages.t("pages.paper")}
          size="small"
          value={current.template}
          onValueChange={(template) => props.onSetTemplate(current.id, template)}
          options={NOTES_TEMPLATES.map((template) => ({
            value: template,
            label: t(`templates.${template}`),
          }))}
        />
      ) : null}
    </>
  );
}

function OutlineTab(props: PageSidebarProps): ReactNode {
  const { messages, icons, newId } = useNotes();
  const { snapshot, currentPage } = props;
  const { outline, pages } = snapshot.notebook;
  const [title, setTitle] = useState("");
  const [renaming, setRenaming] = useState<string | undefined>(undefined);
  const [renamed, setRenamed] = useState("");
  const DeleteIcon = icons["delete"];
  const EditIcon = icons["text"];
  const pageNumber = (page: string) => pages.findIndex((info) => info.id === page) + 1;
  const cut = (value: string) => [...value.trim()].slice(0, NOTES_MAX_TITLE_LENGTH).join("");

  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!currentPage) return;
    const named =
      cut(title) || messages.t("outline.defaultTitle", { page: pageNumber(currentPage) });
    props.onSetOutline([...outline, { id: newId(), title: named, page: currentPage }]);
    setTitle("");
  };

  const rename = (event: FormEvent) => {
    event.preventDefault();
    const named = cut(renamed);
    if (named) {
      props.onSetOutline(
        outline.map((entry) => (entry.id === renaming ? { ...entry, title: named } : entry)),
      );
    }
    setRenaming(undefined);
  };

  return (
    <>
      {outline.length === 0 ? (
        <p className="hm-notes-sidebar-empty">{messages.t("outline.empty")}</p>
      ) : (
        <ul className="hm-notes-outline">
          {outline.map((entry) => (
            <li key={entry.id} className="hm-notes-outline-entry">
              {renaming === entry.id ? (
                <form className="hm-notes-sidebar-form" onSubmit={rename}>
                  <TextField
                    label={messages.t("outline.title")}
                    value={renamed}
                    onValueChange={(value) =>
                      setRenamed(clipToLength(value, NOTES_MAX_TITLE_LENGTH))
                    }
                    autoFocus
                  />
                  <Button size="small" type="submit">
                    {messages.t("outline.save")}
                  </Button>
                </form>
              ) : (
                <>
                  <Button
                    size="small"
                    variant="quiet"
                    classNames={{ root: "hm-notes-outline-link" }}
                    aria-label={messages.t("outline.entry", {
                      title: entry.title,
                      page: pageNumber(entry.page),
                    })}
                    onClick={() => props.onGoToPage(entry.page)}
                  >
                    <span className="hm-notes-outline-title">{entry.title}</span>
                    <span className="hm-notes-outline-page">{pageNumber(entry.page)}</span>
                  </Button>
                  <IconButton
                    size="small"
                    variant="quiet"
                    label={messages.t("outline.rename", { title: entry.title })}
                    icon={EditIcon ? <EditIcon /> : null}
                    onClick={() => {
                      setRenamed(entry.title);
                      setRenaming(entry.id);
                    }}
                  />
                  <IconButton
                    size="small"
                    variant="quiet"
                    label={messages.t("outline.remove", { title: entry.title })}
                    icon={DeleteIcon ? <DeleteIcon /> : null}
                    onClick={() =>
                      props.onSetOutline(outline.filter((other) => other.id !== entry.id))
                    }
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="hm-notes-sidebar-form" onSubmit={add}>
        <TextField
          label={messages.t("outline.title")}
          placeholder={
            currentPage
              ? messages.t("outline.defaultTitle", { page: pageNumber(currentPage) })
              : undefined
          }
          value={title}
          onValueChange={(value) => setTitle(clipToLength(value, NOTES_MAX_TITLE_LENGTH))}
        />
        <Button size="small" type="submit">
          {messages.t("outline.add")}
        </Button>
      </form>
    </>
  );
}

function SearchTab(props: PageSidebarProps): ReactNode {
  const { messages } = useNotes();
  const { snapshot, onSearch } = props;
  const [query, setQuery] = useState("");
  /** The last answer, with the query it answers: an answer to an earlier query isn't shown. */
  const [found, setFound] = useState<
    { readonly query: string; readonly hits: readonly NotesSearchHit[] | undefined } | undefined
  >(undefined);
  /** Counts the times the user asked again, after a search that couldn't run. */
  const [attempt, setAttempt] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const status = useId();
  const pageNumber = (page: string) =>
    snapshot.notebook.pages.findIndex((info) => info.id === page) + 1;

  useEffect(() => {
    field.current?.focus();
  }, []);

  // Searches as the query is typed, a moment after the last key.
  useEffect(() => {
    if (query.trim() === "") return;
    let stale = false;
    const timer = setTimeout(() => {
      void onSearch(query)
        .then((hits) => {
          if (!stale) setFound({ query, hits });
        })
        .catch(() => {
          // Not "no matches": the search didn't run, and can be asked for again.
          if (!stale) setFound({ query, hits: undefined });
        });
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // `attempt` isn't read: a new one runs the same query again.
  }, [query, onSearch, attempt]);
  const answer = query.trim() !== "" && found?.query === query ? found : undefined;
  const hits = answer?.hits;
  const failed = answer !== undefined && answer.hits === undefined;

  const shown = hits?.filter((hit) => pageNumber(hit.page) > 0);
  return (
    <>
      <TextField
        ref={field}
        type="search"
        label={messages.t("search.field")}
        placeholder={messages.t("search.field")}
        value={query}
        onValueChange={setQuery}
        aria-describedby={status}
      />
      <p id={status} className="hm-notes-sidebar-empty" role="status">
        {failed
          ? messages.t("search.failed")
          : shown === undefined
            ? messages.t("search.hint")
            : shown.length === 0
              ? messages.t("search.none")
              : messages.t("search.count", { count: shown.length })}
      </p>
      {failed ? (
        <Button
          size="small"
          onClick={() => {
            setFound(undefined);
            setAttempt((count) => count + 1);
          }}
        >
          {messages.t("search.retry")}
        </Button>
      ) : null}
      {shown && shown.length > 0 ? (
        <ul className="hm-notes-search-results">
          {shown.map((hit) => (
            <li key={`${hit.page}-${hit.source}`}>
              <Button
                size="small"
                variant="quiet"
                classNames={{ root: "hm-notes-search-result" }}
                onClick={() => props.onGoToPage(hit.page)}
              >
                <span className="hm-notes-search-page">
                  {messages.t("search.page", { page: pageNumber(hit.page) })}
                </span>
                <span className="hm-notes-search-snippet">
                  {hit.snippet.slice(0, hit.matchStart)}
                  <mark>{hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)}</mark>
                  {hit.snippet.slice(hit.matchStart + hit.matchLength)}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function RecordingsTab(props: PageSidebarProps): ReactNode {
  const { messages, icons } = useNotes();
  const { snapshot, playback } = props;
  const { recordings } = snapshot.notebook;
  const PlayIcon = icons["play"];
  const PauseIcon = icons["pause"];
  const DeleteIcon = icons["delete"];
  if (recordings.length === 0) {
    return <p className="hm-notes-sidebar-empty">{messages.t("recordings.empty")}</p>;
  }
  return (
    <ul className="hm-notes-recordings">
      {recordings.map((recording, index) => {
        const playing = playback?.recording === recording.id && playback.playing;
        const Icon = playing ? PauseIcon : PlayIcon;
        const name = messages.t("recordings.item", {
          number: index + 1,
          duration: recording.duration,
        });
        return (
          <li key={recording.id} className="hm-notes-recording">
            <IconButton
              size="small"
              variant="quiet"
              label={messages.t(playing ? "recordings.pause" : "recordings.play", {
                number: index + 1,
              })}
              icon={Icon ? <Icon /> : null}
              onClick={() => props.onTogglePlayback(recording.id)}
            />
            <span className="hm-notes-recording-name">{name}</span>
            <IconButton
              size="small"
              variant="quiet"
              label={messages.t("recordings.delete", { number: index + 1 })}
              icon={DeleteIcon ? <DeleteIcon /> : null}
              onClick={() => props.onDeleteRecording(recording.id)}
            />
          </li>
        );
      })}
    </ul>
  );
}
