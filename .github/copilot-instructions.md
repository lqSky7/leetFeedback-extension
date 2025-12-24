# LeetFeedback Extension - AI Agent Instructions

Chrome Extension (Manifest V3) tracking coding practice on LeetCode, GeeksforGeeks, TakeUforward with backend sync.

## Backend API

**Base URL:** `https://traverse-backend-api.azurewebsites.net`

### Auth

```
POST /api/auth/login     { "username": "...", "password": "..." }
POST /api/auth/register  { "username", "email", "password", "github_username", "github_repo", "github_branch" }
GET  /api/auth/verify    Authorization: Bearer <token>
```

### Push Problem Data

```
POST /api/problems/push
Authorization: Bearer <token>

{
  "name": "Two Sum",
  "platform": "leetcode",           // lowercase: leetcode | geeksforgeeks | takeuforward
  "difficulty": 0,                  // 0=Easy, 1=Medium, 2=Hard
  "solved": { "value": true, "date": 1732924800000, "tries": 3 },
  "ignored": false,
  "parent_topic": "Array",          // First topic or "Unknown Topic"
  "grandparent": "Data Structures", // Second topic or "General"
  "problem_link": "https://leetcode.com/problems/two-sum"
}
```

## Storage Keys

| Key                                                            | Type  | Purpose                       |
| -------------------------------------------------------------- | ----- | ----------------------------- |
| `auth_token`                                                   | local | Raw JWT (no "Bearer " prefix) |
| `auth_user`, `firebase_user`                                   | local | User object                   |
| `problem_data_{slug}`                                          | local | Per-problem state             |
| `github_token`, `github_owner`, `github_repo`, `github_branch` | sync  | GitHub config                 |
| `gemini_api_key`                                               | sync  | Mistake analysis              |

## Key Implementation Details

- **Singleton pattern**: Content scripts use singleton extractors for SPA persistence
- **Message passing**: Background handlers must `return true` for async responses
- **Token format**: Stored raw, "Bearer " added when making requests
- **Difficulty mapping**: LeetCode (easy/medium/hard), GFG adds (school/basic → 0)
- **Topics**: Array stored locally → `parent_topic` (first) + `grandparent` (second) for backend
- **Backend push**: Currently only LeetCode pushes to backend on successful submission
