---
"@hussmartinez/ui": minor
---

`ReorderableList` keeps focus on its cells, never on the controls inside them, so NVDA stays in the mode that sends keys to the list. Before, → moved focus onto a row's control, such as a visibility toggle. NVDA then switched to browse mode, as it does by default on a button, and kept the arrows and Alt+↑/↓ for itself, so the list couldn't be reordered from there.

Now a control's cell takes focus in its place:

- Its name is the control's name with its `aria-pressed` or `aria-checked` state, such as "Visible, pressed".
- Space and Enter on it press the control.
- A click on the control leaves focus on the cell.
- The control itself has no Tab stop.

Four new messages word the state: `reorderableList.control.pressed`, `notPressed`, `checked` and `notChecked`, each with a `{label}`. Translate them with your other overrides. If your tests expect focus on a row's control after →, expect it on the control's cell (`[data-hm-cell="control"]`) instead.
