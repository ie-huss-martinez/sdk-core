import {
  createContext,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { warnInDevelopment } from "../../internal/development.js";
import { uiEditorText } from "../../messages/editor.js";
import { useAnnounce } from "../announcer/Announcer.js";
import { Button } from "../button/Button.js";
import { IconButton } from "../button/IconButton.js";
import { CloseIcon } from "../dialog/CloseIcon.js";
import { useUiText } from "../messages/UiMessagesProvider.js";
import { cx, type StyleProps, unstyledAttribute } from "../shared/style-props.js";

declare const process: { readonly env: { readonly NODE_ENV?: string } };

/**
 * What a toast says, and what it offers.
 *
 * @public
 */
export interface ToastOptions {
  /** Plain text from your message catalogue, such as "Rotated". */
  readonly message: string;
  /** `danger` for errors, which are also announced assertively. Defaults to `neutral`. */
  readonly tone?: "neutral" | "success" | "danger" | undefined;
  /**
   * One action, such as Undo. Running it dismisses the toast. Give it a
   * keyboard shortcut too, because the toast goes away on its own.
   */
  readonly action?: { readonly label: string; readonly onAction: () => void } | undefined;
  /** How long it stays, in milliseconds, while not hovered or focused. Defaults to 2600. */
  readonly duration?: number | undefined;
}

/**
 * What {@link useToast} returns.
 *
 * @public
 */
export interface ToastApi {
  /** Shows a toast and returns its id. */
  readonly show: (options: ToastOptions) => string;
  /** Removes a toast early. */
  readonly dismiss: (id: string) => void;
}

/**
 * The parts of the toasts that `classNames` can target.
 *
 * @public
 */
export type ToastPart = "root" | "toast" | "message" | "action" | "dismiss";

/**
 * Props of {@link ToastProvider}.
 *
 * @public
 */
export interface ToastProviderProps extends StyleProps<ToastPart> {
  readonly children?: ReactNode;
  /** How many toasts show at once; the oldest goes first. Defaults to 3. */
  readonly max?: number | undefined;
  /** The dismiss buttons' accessible name. Defaults to `toast.dismiss` from the messages. */
  readonly dismissLabel?: string | undefined;
  /** The toasts' region's accessible name. Defaults to `toast.region` from the messages. */
  readonly label?: string | undefined;
}

interface ToastRecord {
  readonly id: string;
  readonly message: string;
  readonly tone: "neutral" | "success" | "danger";
  readonly action: ToastOptions["action"];
  readonly duration: number;
}

const DURATION = 2600;

const ToastContext = /* @__PURE__ */ createContext<ToastApi | undefined>(undefined);

function showWithoutProvider(): string {
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
    warnInDevelopment("useToast needs a ToastProvider above it; the toast wasn't shown.");
  }
  return "";
}

function dismissWithoutProvider(): void {}

const withoutProvider: ToastApi = { show: showWithoutProvider, dismiss: dismissWithoutProvider };

/**
 * Shows short messages over the foot of the page, each with one optional
 * action such as Undo (sdk-core ADR 0067).
 *
 * - **In the top layer** (docs/adr/0006), centred at the foot of the
 *   viewport, above every stacking context and modal dialog shown before.
 * - **Never takes focus.** Each toast stays for its duration, paused while
 *   the pointer is over the toasts or focus is inside them, then goes.
 * - **Spoken once,** through {@link useAnnounce}: politely, or assertively for
 *   `danger`. The toasts themselves aren't a live region. Render it inside an
 *   `AnnouncerProvider`.
 *
 * @example
 * ```tsx
 * const toast = useToast();
 * toast.show({ message: messages.t("toast.rotated"), action: { label: messages.t("undo"), onAction: undo } });
 * ```
 *
 * @public
 */
export function ToastProvider({
  children,
  max = 3,
  dismissLabel,
  label,
  className,
  classNames,
  unstyled,
}: ToastProviderProps): ReactElement {
  const defaultDismiss = useUiText("toast.dismiss", uiEditorText);
  const defaultLabel = useUiText("toast.region", uiEditorText);
  const announce = useAnnounce();
  const [toasts, setToasts] = useState<readonly ToastRecord[]>([]);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const count = useRef(0);
  // The ids showing, kept beside the state so callbacks can read them.
  const live = useRef(new Set<string>());
  const region = useRef<HTMLElement>(null);

  const dismiss = useCallback((id: string) => {
    live.current.delete(id);
    setToasts((list) => list.filter((toast) => toast.id !== id));
    // A removed toast that held focus doesn't always report losing it.
    requestAnimationFrame(() => {
      if (!region.current?.contains(document.activeElement)) {
        setFocused(false);
      }
    });
  }, []);

  const show = useCallback(
    (options: ToastOptions): string => {
      count.current += 1;
      const id = `hm-toast-${count.current}`;
      const tone = options.tone ?? "neutral";
      const record: ToastRecord = {
        id,
        message: options.message,
        tone,
        action: options.action,
        duration: options.duration ?? DURATION,
      };
      if (live.current.size === 0) {
        // The toasts were hidden, so whatever hovered or focused them has left.
        setHovered(false);
        setFocused(false);
      }
      live.current.add(id);
      for (const oldest of live.current) {
        if (live.current.size <= Math.max(1, max)) {
          break;
        }
        live.current.delete(oldest);
      }
      setToasts((list) => [...list, record].slice(-Math.max(1, max)));
      announce(options.message, { politeness: tone === "danger" ? "assertive" : "polite" });
      return id;
    },
    [announce, max],
  );

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  // Shown in the top layer while there's a toast, hidden when there's none.
  const hasToasts = toasts.length > 0;
  useEffect(() => {
    const element = region.current;
    if (!element || typeof element.showPopover !== "function") {
      return;
    }
    const isOpen = element.matches(":popover-open");
    if (hasToasts && !isOpen) {
      element.showPopover();
    } else if (!hasToasts && isOpen) {
      element.hidePopover();
    }
  }, [hasToasts]);

  const paused = hovered || focused;

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section
        ref={region}
        popover="manual"
        aria-label={label ?? defaultLabel}
        className={cx("hm-toast-region", classNames?.root, className)}
        data-hm-unstyled={unstyledAttribute(unstyled)}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setFocused(false);
          }
        }}
      >
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            paused={paused}
            dismiss={dismiss}
            dismissLabel={dismissLabel ?? defaultDismiss}
            classNames={classNames}
            unstyled={unstyled}
          />
        ))}
      </section>
    </ToastContext.Provider>
  );
}

interface ToastItemProps {
  readonly toast: ToastRecord;
  readonly paused: boolean;
  readonly dismiss: (id: string) => void;
  readonly dismissLabel: string;
  readonly classNames: ToastProviderProps["classNames"];
  readonly unstyled: boolean | undefined;
}

function ToastItem({ toast, paused, dismiss, dismissLabel, classNames, unstyled }: ToastItemProps) {
  // Time left, kept across pauses.
  const remaining = useRef(toast.duration);

  useEffect(() => {
    if (paused) {
      return;
    }
    const started = Date.now();
    const timer = setTimeout(() => dismiss(toast.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [paused, dismiss, toast.id]);

  return (
    <div
      className={cx("hm-toast", classNames?.toast)}
      data-hm-tone={toast.tone === "neutral" ? undefined : toast.tone}
    >
      <span className="hm-toast-indicator" aria-hidden="true" />
      <span className={cx("hm-toast-message", classNames?.message)}>{toast.message}</span>
      {toast.action ? (
        <Button
          variant="quiet"
          size="small"
          className={cx("hm-toast-action", classNames?.action)}
          unstyled={unstyled}
          onClick={() => {
            toast.action?.onAction();
            dismiss(toast.id);
          }}
        >
          {toast.action.label}
        </Button>
      ) : null}
      <IconButton
        variant="quiet"
        size="small"
        label={dismissLabel}
        icon={<CloseIcon />}
        className={cx("hm-toast-dismiss", classNames?.dismiss)}
        unstyled={unstyled}
        onClick={() => dismiss(toast.id)}
      />
    </div>
  );
}

/**
 * Shows toasts through the closest {@link ToastProvider}. Without one,
 * `show` does nothing and warns in development.
 *
 * @public
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? withoutProvider;
}
