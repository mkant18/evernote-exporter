# Read your saved Evernote notes

**Keep Evernote exactly as it is:** this app works from files already exported from Evernote. It does not sign in to Evernote. If you do not already have those files, stop here and ask Michael for help. We have not established a live export method that guarantees unchanged “last viewed” dates. Opening Evernote just to export is not covered by that guarantee.

1. Download **Evernote-Archive-0.2.1-Windows.zip** from the [GitHub release](https://github.com/mkant18/evernote-exporter/releases/tag/v0.2.1). Right-click it and choose **Extract All**. Keep the extracted folder somewhere permanent on your Windows PC.
2. Install [Node.js](https://nodejs.org/en/download) version 22 or later if needed. Choose the Windows installer. This is a one-time prerequisite; the ZIP does not contain Node.js.
3. In the extracted folder, double-click **Start Evernote Archive.cmd**. The first run needs internet to install its locked dependencies. Your browser opens the archive; your notes stay on the PC.
4. Choose **Add notebooks → Choose ENEX files**. Select your existing `.enex` files. Give each file its notebook name, then choose **Add to archive**. To practise first, use the included `examples/sample.enex`, which contains only invented notes.
5. Click a notebook, then a note. Try search, tags, and an attachment download. Reading here does not contact Evernote. Note links are intentionally inactive. Opening a downloaded attachment in another app is outside this reader's protection.
6. Choose **Take this notebook → Complete archive** and save the ZIP to your backup drive. Repeat for every imported file. Keep the original ENEX files too.

Want another notes app? Follow the [walkthrough](docs/user-guide.md#try-another-notes-app). It explains trying Joplin with copies, without signing it into Evernote.

Want to read on your iPhone? Follow [Read on your iPhone](docs/user-guide.md#read-on-your-iphone). Your PC must stay on and both devices must use the same trusted Wi-Fi.

Do not delete, reorganize, import into, or restore anything in the original Evernote account. Importing back into it would change it. A successful file import here does not prove that every note, notebook, or account feature was exported.

If a window reports an error, keep it open and show Michael the message. Do not send anyone your notes or the private connection link. The full [guide](docs/user-guide.md) covers recovery, file limits, and migration checks.
