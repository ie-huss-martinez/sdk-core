---
"@hussmartinez/ui": patch
---

`EditorFrame` takes `propertiesFooter`: host content under the properties panel, in the same column, such as an app's 160 × 600 ad slot (sdk-core ADR 0067, amended). An SDK editor passes it through from a prop of its own, unchanged.

- **Where it goes:** the panel stays on top with its full content, and the footer sits at the foot of the column at its own size, never stretched or shrunk, and no wider than the panel. It's outside the panel's "Properties" landmark, and adds no landmark or tab stop of its own: what's inside is the host's.
- **When it shows:** only while the panel's content at its full height and the footer both fit in the column. Otherwise it hides and the panel keeps the whole column, scrolling as before. It's also hidden below 45 rem, where the properties sit under the stage. Its content stays mounted while it's hidden.
- **Without a panel:** with no `properties`, or `propertiesState` set to `"hidden"`, the column stays with just the footer at its foot, as wide as the panel, so the stage doesn't move when the panel comes back. That's from 60 rem, where the column sits beside the stage, and while the footer fits the column's height; otherwise the column goes as it does without a footer. Between 45 and 60 rem, where the properties float over the stage, the footer never floats there alone and hides. The properties toggle, the edge tab and the panel's `hidden` attribute behave as before.
- **New part:** `classNames.propertiesFooter`.

Nothing changes without the prop, but the panel now sits in a new `.hm-editor-frame-properties-column`, which floats over the stage below 60 rem in its place: a stylesheet that positioned `.hm-editor-frame-properties` itself should target the column.
