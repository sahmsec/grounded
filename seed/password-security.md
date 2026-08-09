---
slug: password-security
title: Password Security
source: Internal Security Handbook, Section 4.1
category: identity
tags: passwords, credentials, hashing, password-manager
---

Passwords remain the most common way people prove who they are, and the most common way accounts are lost. Good password practice has changed substantially over the last decade, and much of the advice organisations still enforce actively makes security worse.

## Advice that has been superseded

Mandatory periodic expiry — forcing everyone to change passwords every sixty or ninety days — is no longer recommended by NIST or the UK National Cyber Security Centre. It pushes people toward predictable patterns such as appending an incrementing number, and it provides little protection because an attacker who steals a password uses it within minutes, not months. Change passwords when there is a reason to believe they have been exposed, not on a calendar.

Complexity rules that demand a mixture of character classes produce passwords that are hard for humans to remember and easy for machines to guess, because everyone solves the puzzle the same way. Length contributes far more to strength than character variety.

## What works

Length is the primary factor. A passphrase of several unrelated words is both stronger and easier to remember than a short string of substituted symbols. Set a generous maximum length and never truncate silently.

Screen new passwords against lists of known-breached and commonly used credentials. Most successful password attacks are not brute force at all — they are credential stuffing, where an attacker replays username and password pairs leaked from some other service. Blocking known-compromised passwords stops this at the source.

Encourage a password manager. It is the only realistic way for a person to have a unique, long, random password for every account, and unique passwords are what break the credential stuffing chain. The concentration risk of a single vault is real but is far smaller than the risk of reuse across dozens of sites.

Never reuse a password between a work account and a personal one, and treat email as the most critical account of all, since it can usually reset everything else.

## Storing passwords as a service operator

Never store passwords in plain text and never encrypt them reversibly. Hash them with a slow, memory-hard algorithm designed for the purpose: Argon2id is the current preference, with scrypt and bcrypt as acceptable alternatives. General-purpose hashes such as SHA-256 are unsuitable because they are fast, which is precisely what an attacker wants.

Use a unique random salt per password so identical passwords produce different hashes and precomputed tables are useless. Tune the work factor to the slowest hardware you must support, and revisit it as hardware improves.

Compare hashes in constant time, rate-limit authentication attempts by account and by source, and make failure messages identical whether the username exists or not, so the login form cannot be used to enumerate accounts.

## Beyond passwords

The strongest position is to stop relying on passwords alone. Multi-factor authentication means a stolen password is not sufficient on its own, and passkeys remove the shared secret entirely by replacing it with a private key that never leaves the user's device and is never transmitted. Where passkeys can be deployed, they eliminate phishing, reuse, and database theft in a single change.
