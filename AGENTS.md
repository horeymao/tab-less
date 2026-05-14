# AGENTS.md -- Tab Out: Setup & Onboarding Guide for Coding Agents

You're installing **Tab Out** for the user. Your job is not just to set it up -- it's to get them excited about using it.

---

## Step 0 -- Introduce the product

Before doing anything technical, tell the user what they're about to get:

> **Tab Out** replaces your new tab page with a clean bento dashboard of everything you have open, grouped by domain.
>
> Here's what makes it great:
> - **Bento dashboard** open tabs grouped by domain on a color-coded masonry grid (6 rotating themes)
> - **Homepages group** pulls Gmail, X, LinkedIn, YouTube, GitHub homepages into one card for easy cleanup
> - **Quick links / shortcuts** pin your most-used sites at the top, add or remove anytime
> - **Rainbow greeting** every letter of "Good afternoon" gets a different theme color
> - **Close tabs with style** satisfying swoosh sound + confetti burst, themed toast confirms each action
> - **Duplicate detection** the same page open twice gets a `2x` badge on the row
> - **Click any tab title to jump to it** even across different Chrome windows
> - **100% local** no server, no accounts, no data sent anywhere
>
> It's just a Chrome extension. Setup takes about 1 minute.

---

## Step 1 -- Clone the repo

```bash
git clone https://github.com/zarazhangrui/tab-out.git
cd tab-out
```

---

## Step 2 -- Install the Chrome extension

This is the one step that requires manual action from the user. Make it as easy as possible.

**First**, print the full path to the `extension/` folder:
```bash
echo "Extension folder: $(cd extension && pwd)"
```

**Then**, copy the `extension/` folder path to their clipboard:
- macOS: `cd extension && pwd | pbcopy && echo "Path copied to clipboard"`
- Linux: `cd extension && pwd | xclip -selection clipboard 2>/dev/null || echo "Path: $(pwd)"`
- Windows: `cd extension && echo %CD% | clip`

**Then**, open the extensions page:
```bash
open "chrome://extensions"
```

**Then**, walk the user through it step by step:

> I've copied the extension folder path to your clipboard. Now:
>
> 1. You should see Chrome's extensions page. In the **top-right corner**, toggle on **Developer mode** (it's a switch).
> 2. Once Developer mode is on, you'll see a button called **"Load unpacked"** appear in the top-left. Click it.
> 3. A file picker will open. **Press Cmd+Shift+G** (Mac) or **Ctrl+L** (Windows/Linux) to open the "Go to folder" bar, then **paste** the path I copied (Cmd+V / Ctrl+V) and press Enter.
> 4. Click **"Select"** or **"Open"** and the extension will install.
>
> You should see "Tab Out" appear in your extensions list.

**Also**, open the file browser directly to the extension folder as a fallback:
- macOS: `open extension/`
- Linux: `xdg-open extension/`
- Windows: `explorer extension\\`

---

## Step 3 -- Show them around

Once the extension is loaded:

> You're all set! Open a **new tab** and you'll see Tab Out.
>
> Here's how it works:
> 1. **Your open tabs are grouped by domain** on a color-coded bento grid.
> 2. **Homepages** (Gmail inbox, X home, YouTube, etc.) are in their own group at the top.
> 3. **Quick-link shortcuts** sit at the top — click the `+ Shortcut` chip to pin a new site, hover an existing one and click the `×` to remove it.
> 4. **Click any tab title** to jump directly to that tab, even in another Chrome window.
> 5. **Hover a tab row** and click the `×` to close just that one (swoosh + confetti).
> 6. **Click "Close all N tabs"** at the bottom of a card to close the whole group.
> 7. **Duplicate tabs** are flagged with a colored `2x` badge on the row.
>
> That's it! No server to run, no config files. Everything works right away.

---

## Key Facts

- Tab Out is a pure Chrome extension. No server, no Node.js, no npm.
- Pinned shortcuts are stored in `chrome.storage.local` (persists across sessions).
- 100% local. No data is sent to any external service.
- To update: `cd tab-out && git pull`, then reload the extension in `chrome://extensions`.
