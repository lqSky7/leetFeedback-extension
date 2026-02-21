# Understand the extension

This folder holds documentation that explains how the Traverse (LeetFeedback) Chrome extension works: architecture, workflows, message flows, and the LeetCode integration in detail.

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Manifest, script load order, roles of background/sidepanel/content scripts, storage, and web-accessible resources. |
| [WORKFLOWS.md](WORKFLOWS.md) | User and data flows (page load, run, submit, sidepanel) and message “chats” (content ↔ background, LeetCode Monaco bridge). |
| [LEETCODE.md](LEETCODE.md) | Deep dive on **leetcode.js**: entry point, LeetCodeExtractor, Monaco bridge, persistence, observers, and the successful-submission pipeline. |
| [CONTENT-SCRIPTS-AND-UTILS.md](CONTENT-SCRIPTS-AND-UTILS.md) | All three platform scripts (LeetCode, GeeksforGeeks, TakeUForward), shared utils, and tables for “who uses which util” and “who sends which messages”. |

Start with **ARCHITECTURE.md** for the big picture, then **WORKFLOWS.md** for flows and messages, **LEETCODE.md** for the LeetCode-specific behavior, and **CONTENT-SCRIPTS-AND-UTILS.md** for a full map of scripts and utilities.
