# Evernote Exporter

A Windows-first, cross-platform tool to fully export Evernote data into a portable neutral format, preserving tags, checklists, attachments, and notebook structure — so you can migrate to any notes system later.

## Why

Evernote's native export (`.enex`) is XML-based and tied to Evernote's schema. This tool parses that export into a clean, system-agnostic format, giving you full ownership of your data before deciding where it goes next.

## Planned Phases

1. **Export** — Parse `.enex` files into a neutral JSON archive (tags, checklists, attachments, metadata intact)
2. **Store** — Save the neutral archive locally in a human-readable structure
3. **Import** — Adapters to push the archive into target systems (Markdown files, OneNote, Notion, etc.)

## Tech

- Node.js (core export engine)
- Electron (future GUI)

## Usage

_No runnable code yet — see the roadmap above._

## Project Structure

```
src/
  core/
    models/     # Note, Notebook, Tag, Attachment data shapes
    storage/    # Neutral intermediate format
  parsers/
    enex/       # ENEX XML → core models
  exporters/
    markdown/   # Core models → Markdown
    json/       # Core models → neutral JSON archive
tests/
docs/
```
