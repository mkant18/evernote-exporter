# From Evernote to your archive, iPhone, and back

## 1. Make the source export

In Evernote for Windows or Mac, right-click a notebook, choose **Export**, and choose **ENEX**. Include tags, dates and other note attributes. Export one notebook at a time when preserving groups matters. If Evernote splits a large notebook into several files, add each part and give each the same notebook label; this app stores the parts separately.

Keep these original exports somewhere safe. This app does not sign into Evernote or check whether you exported every notebook. Evernote Web and iPhone do not supply the desktop notebook-export workflow. See [Evernote's export instructions](https://help.evernote.com/hc/en-us/articles/209005557-Export-Notes-and-Notebooks-as-ENEX-or-HTML).

## 2. Start the app on your PC

Install Node.js 22 or later if it is not already installed. Double-click **Start Evernote Archive.cmd**. The first launch installs the locked dependencies; later launches work without internet. A browser opens with your private connection link.

The app runs in the background and keeps your notebooks in `archives/app` beside the application. Closing the browser does not stop the app. The launcher prints its process ID and stop command. Reopening the launcher reuses a running session. Stop that process or restart the PC to end the session; your stored library remains.

For a visible terminal instead: `npm start`. Press Ctrl+C in that terminal to stop.

## 3. Import and check

Choose **Add notebooks**, select or drop ENEX files, review each notebook name, and optionally enter a stack. Names are your assignments, not recovered Evernote metadata. Select **Add to archive**. Files are converted sequentially; failed files stay in the queue with an explanation and can be retried. Completed notebooks remain available even if another file fails.

Open a notebook, search its text or choose a tag, then select a note. Check representative notes, dates, checklists and attachments. Expand **About this archive** and note-level conversion notices. An archive that verifies successfully can still contain unsupported features or cover only part of your account.

The reader does not edit notes or fetch remote note images. Attachments are downloaded on request; supported local images are previewed. Encrypted content remains encrypted. Structured Tasks and other unsupported metadata remain in the original/source records.

## 4. Read on your iPhone

Double-click **Start on iPhone.cmd** on the PC. This starts a separate private-network session on port 4319. In the app, select **Use on iPhone** and copy the private link into Safari on your iPhone. Both devices must be on the same trusted Wi-Fi, and the PC must stay awake and running.

If Windows asks whether Node.js may receive connections, allow only the private network you intend to use. The app does not change firewall rules automatically. If the page cannot connect, check that the phone is on Wi-Fi rather than cellular, the PC has not slept, and the router does not isolate wireless clients. VPNs may affect reachability. Local sharing uses HTTP, not encrypted HTTPS, so do not use a public/shared network for private notes.

Anyone who has the private link and can reach the PC can access this library. The key is in the link fragment; it is removed from the browser address after connection and held in that tab's session storage. A new app process normally generates a new key. Use the current launcher link if an older one stops working. No notebooks are published to the internet by this app.

The layout supports a narrow screen: choose a notebook, tap a note, and use **Back to notes** to return to the list. You may use Safari's Add to Home Screen as a shortcut, but this is not an installed offline native app or service-worker PWA.

## 5. Take a copy elsewhere

Select **Take this notebook**:

| Download | Use |
| --- | --- |
| Portable reader | A self-contained HTML reading copy with safe markup and embedded attachments. Open in a browser; file-opening/download behavior on iPhone still depends on Safari/Files. No app server is needed once the file is available in a capable viewer. Maximum output 32 MiB. |
| Markdown | ZIP containing Markdown notes, safe relative attachment paths, the original ENEX, and an archive manifest. Extract the entire ZIP; keep `notes` and `assets` together. Rich styles and structured Tasks are not fully represented in Markdown. |
| Evernote ENEX | Exact original export bytes for restoring through Evernote. No custom JSON conversion is needed. |
| Complete archive | ZIP containing JSON notes, attachments, integrity manifest and original source. This is the full portable backup, not a file Evernote directly imports. |

For a library backup, stop the app and copy the entire `archives/app` directory, or save a complete archive ZIP for each imported file. Keep backups outside the project folder and verify copies. To restore this application's library on another PC, install the app and copy the saved `archives/app` directory into the same relative location before starting it. A complete archive ZIP can instead be extracted, verified with the CLI, and its `sources/original.enex` re-imported through the app; re-enter notebook/stack labels from the manifest.

## 6. Return the notes to Evernote

Download **Evernote ENEX**. In Evernote for Windows or Mac, choose **File → Import** and select the ENEX file. Inspect the imported notes, attachments and checklists, arrange notebook/stack organization if needed, allow Evernote to sync, then open Evernote on your iPhone and check the same examples.

This restores the original exported notes. It does not write the archive app's assigned notebook/stack labels back into ENEX. Importing can create duplicate notes if the originals are already in the target account, so use a clearly separated import notebook and review before reorganizing anything. No original notes are deleted by this app.

Evernote's [import instructions](https://help.evernote.com/hc/en-us/articles/360035153274-How-To-Import-Notes-and-Notebooks) document the desktop route. That page also includes Web instructions alongside an inconsistent desktop-only statement; this guide uses the explicit desktop path. The app does not certify Web import or live account synchronization. Its custom JSON archive is not an Evernote import format.

## If something fails

An invalid ENEX or failed conversion does not modify your input. Retry with a fresh export or a smaller file, and retain the originals. If a notebook is reported unreadable, keep its files and use CLI verification before relying on it. Do not manually edit the manifest to silence a checksum error.

Launcher logs and private session links are in `.runtime`; do not share that directory. Conversion/test artifacts are in `.evidence` and are not part of the library. Real account/device acceptance is separate from the synthetic fixtures used during development.
