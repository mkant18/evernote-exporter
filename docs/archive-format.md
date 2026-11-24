# Neutral archive format, version 1

All JSON is UTF-8 with two-space indentation. Payload paths are relative to the archive root and use `/`. No timestamps from the conversion machine are included, so the same input bytes and options produce identical output. This is an initial versioned contract; readers must reject unsupported versions.

## Manifest

`manifest.json` contains `format: "evernote-neutral-archive"`, `schemaVersion: 1`, and `completeness: "unverified"`. The latter is always unverified: conversion of a supplied file does not establish account coverage or representational completeness.

`source` gives `path`, `originalFilename`, `sha256` and the source root's `attributes`. The absolute input path is not stored. `organization` is either null or `{name, stack, provenance: "user-supplied"}`; `stack` may be null. `tags` is the sorted union of note tag labels, without hierarchy.

`notes` lists `{id, path, sourceOrdinal}` in source order. A local ID combines the first 16 hex characters of the source SHA-256 with a 1-based ordinal padded to six digits. These are archive-local identifiers, not Evernote identities; changes to source bytes change IDs. Identical titles or contents do not cause notes to be merged.

`counts` contains `notes`, `attachments` (resource occurrences) and `uniqueAssets` (distinct attachment byte sequences). `files` lists `{path, bytes, sha256}` for the retained source, each note JSON and each distinct asset. The manifest does not hash itself. `warnings` contains `{code, detail}` and optionally `noteId`; note-specific warnings also appear on the note.

## Notes

Each note includes `schemaVersion`, `id`, `sourceIdentity: null`, `title`, `created`, `updated`, `tags`, `notebook`, `content`, `checkboxes`, `links`, `attachments`, `sourceMetadata`, `sourceAttributes` and `warnings`.

Dates are UTC ISO strings or null. Missing dates are null; invalid dates produce warnings and remain in source metadata. Tag labels preserve order and spelling. `notebook` repeats the manifest's organization assignment.

`content.enml` retains the extracted ENML string. `content.plainText` is a convenience projection with block newlines, checkbox markers, attachment labels and an encrypted-content placeholder; it is not a formatting-faithful rendition. `content.document` is an ordered tree:

| Type | Fields |
| --- | --- |
| `document` | `attributes`, `children` |
| `element` | `name`, `attributes`, `children` |
| `text` | `text` |
| `checkbox` | `checked`, `attributes` |
| `attachment` | `attachmentId`, `attributes` |
| `encrypted` | `ciphertext`, `attributes` |

Checkbox `checked` is boolean, or null with a warning for an unrecognized source value. An attachment reference is null with a warning if its source media hash cannot be resolved. Attributes are preserved as data, including untrusted links and styling. Never inject this tree or original ENML as unescaped HTML into a viewer. XML comments and processing instructions are retained only in the original source/ENML, not the normalized tree.

`checkboxes` lists `{index, checked}` in document order. `links` lists anchor hrefs without rewriting. Evernote links remain unresolved and generate warnings.

## Resources and metadata

Each attachment records `id`, `filename` (possibly null), `mime`, `bytes`, `md5`, `sha256`, `path`, `metadata`, `sourceAttributes` and `dataAttributes`. MD5 is used only to match ENML media placement; SHA-256 provides stored payload integrity and deduplication. Filenames are never used to construct stored paths. Asset filenames deliberately have no inferred extension; original filename and MIME type are available in JSON.

`sourceMetadata` and resource `metadata` use generic XML nodes `{name, attributes, children}`; children may be text strings or further nodes. Note metadata excludes content and resources, which have their own fields. Resource metadata excludes primary base64 `data`, whose decoded bytes are stored as the asset. Task elements, reminders, OCR and alternate data remain inspectable, but this version does not fully interpret them. Unknown note-level fields and OCR/alternate resource data produce warnings. The exact original ENEX covers all unconverted source syntax.

## Failure and integrity boundaries

Malformed XML/ENML, invalid UTF-8, duplicate required singleton fields, invalid base64, declared attachment hash mismatches and unsupported encoding fail the export. Missing media, encrypted text, invalid dates and unsupported conversions are retained with warnings. External DTD fetching and custom entity expansion are disabled.

`verify` checks stored-byte integrity, required note/content fields, asset MD5/media references and checkbox/link summaries. It also streams the retained source to reconcile note counts/order, local IDs, title, original ENML, tags, metadata and resource bytes/filenames/MIME. Successful verification includes `sourceNotesReconciled: true`. It does not independently reconstruct every normalized rich-content operation, reconcile a live account, or authenticate a signature. An attacker who replaces both data and manifest can recompute checksums. Files outside the manifest inventory are not authenticated. Keep original exports until a separately verified migration and owner acceptance.

Style-based Evernote checklist lists normalize to their preserved `li` element with a prepended `checkbox` child. Legacy `en-todo` normalizes directly to a checkbox leaf. Explicit line breaks and table-cell separators are retained in the plain-text projection. These fixes preserve the version-1 node vocabulary.
