# Security Specification & Payload-First Verification

## 1. Data Invariants
1. **PII Isolation**: `/users/{userId}` holds `email` and `studentId` and is readable ONLY by `request.auth.uid == userId` or `isAdmin()`. Approved non-PII directory records live in `/membersPublic/{memberId}`.
2. **No Self-Approval / Privilege Escalation**: A newly registered user can ONLY create `/users/{userId}` with `status == 'pending'` (unless `isAdmin()`), and ONLY `isAdmin()` can create/delete `/membersPublic/{memberId}` or `/admins/{adminId}` or modify `users/{userId}.status`.
3. **Member-Only Access Gate**: `/boardPosts`, `/researchTrends`, `/settings/communityLinks`, and `/membersPublic` are strictly accessible only to verified approved members (`exists(/databases/$(database)/documents/membersPublic/$(request.auth.uid))` or `isAdmin()`).
4. **Immutable Ownership & Server Timestamps**: `authorUid` and `createdAt` cannot be forged or altered after creation; `createdAt` and `updatedAt` must equal `request.time`.
5. **Verified Email Mandate**: Every privileged or member write requires `request.auth.token.email_verified == true`.
6. **Parent Existence on Subcollections**: Creating a comment under `/boardPosts/{postId}/comments/{commentId}` or `/researchTrends/{trendId}/comments/{commentId}` requires parent document `exists(...)`.

## 2. Dirty Dozen Attack Payloads (All Expected: PERMISSION_DENIED)
1. **Self-Approval Attack**: User creates `/users/attackerUid` with `{ ..., status: 'approved' }` -> Denied (`incoming().status == 'pending'` required for non-admins).
2. **Shadow Field Injection**: User creates `/boardPosts/post1` with extra ghost field `isVerified: true` -> Denied (`keys().hasOnly(...)`).
3. **Email Spoofing Attack**: Token has `email: 'schaum@mju.ac.kr'` with `email_verified: false` -> Denied (`email_verified == true` required).
4. **PII Read Leak**: Approved member B attempts `get(/users/memberAUid)` -> Denied (`isOwner` or `isAdmin` required).
5. **Unapproved Board Read**: Pending user attempts `list(/boardPosts)` or `get(/settings/communityLinks)` -> Denied (`isApprovedMember()` required).
6. **Admin Escalation**: Approved member attempts to create `/admins/memberUid` -> Denied (`isAdmin()` required).
7. **Post Author Impersonation**: Approved member creates `/boardPosts/p2` with `authorUid: 'someoneElse'` -> Denied (`authorUid == request.auth.uid`).
8. **Foreign Post Edit/Delete**: Approved member B attempts to update or delete member A's `boardPost` -> Denied (`existing().authorUid == request.auth.uid || isAdmin()`).
9. **Pin Hijacking**: Non-admin member creates `boardPosts` or `researchTrends` with `isPinned: true` -> Denied (`isAdmin() || incoming().isPinned == false`).
10. **ID Poisoning**: User creates `/boardPosts/invalid$id!with*badchars` or >128 chars -> Denied (`isValidId()` regex + length).
11. **Timestamp Forgery**: User creates `boardPosts` with backdated `createdAt: Timestamp(2020-01-01)` -> Denied (`createdAt == request.time`).
12. **Orphan Comment Injection**: User creates `/boardPosts/nonExistentPost/comments/c1` -> Denied (`exists(/databases/$(database)/documents/boardPosts/$(postId))`).
