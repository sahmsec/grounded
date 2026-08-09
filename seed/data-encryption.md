---
slug: data-encryption
title: Data Encryption
source: Internal Security Handbook, Section 7.2
category: data-protection
tags: encryption, tls, at-rest, in-transit, key-management
---

Encryption converts data into a form that is unreadable without the correct key. It is the primary technical control for keeping information confidential when the systems holding or carrying it cannot be fully trusted.

## In transit and at rest

Encryption in transit protects data moving across a network. On the web this means TLS, which both conceals the content and verifies that you are talking to the server you intended. Modern practice is TLS 1.2 as a floor and TLS 1.3 where available, with older protocol versions disabled outright. Certificates should be automated, since the most common TLS incident by far is an expired certificate rather than a broken cipher.

Encrypt internal traffic too. The assumption that traffic inside a data centre or a virtual private cloud needs no protection is exactly the assumption a zero trust model rejects, and internal capture is a routine step in real intrusions.

Encryption at rest protects stored data. Full-disk encryption on laptops and phones is essential and largely solves the lost-device problem. Database and object storage encryption protects against theft of the underlying media or a misconfigured storage bucket.

It is worth being clear about what at-rest encryption does not do. If an application can read the data, then an attacker who compromises that application can read it too, because the decryption happens automatically for authorised processes. Full-disk encryption protects a stolen laptop; it does nothing against a running system that an intruder already controls.

## Choosing algorithms

Use well-established, widely reviewed algorithms and standard library implementations. AES with 256-bit keys in an authenticated mode such as GCM, or ChaCha20-Poly1305, are the sensible defaults for symmetric encryption. Authenticated modes matter because they detect tampering as well as concealing content; unauthenticated encryption allows an attacker to modify ciphertext in ways that produce predictable changes in the decrypted output.

Never design your own cryptographic scheme, and be sceptical of any product that advertises proprietary encryption. The security of standard algorithms comes from decades of public analysis that a private design has not received.

For hashing passwords, use a deliberately slow, memory-hard function rather than an encryption algorithm — that is a distinct problem with distinct tools.

## Key management

Key management is where encryption projects usually fail. The strongest algorithm provides nothing if the key sits in the application's source repository, in an environment variable printed to logs, or in a configuration file backed up alongside the data it protects.

Store keys in a dedicated key management service or hardware security module. Separate the key from the data it protects, so a single compromise does not yield both. Restrict who and what can use a key, and log every use.

Plan for rotation before you need it. Rotating a key that was never designed to be rotated means re-encrypting everything under time pressure. Envelope encryption helps: data is encrypted with a per-object data key, and that key is itself encrypted by a master key, so rotating the master key requires re-wrapping small keys rather than re-encrypting bulk data.

Plan for recovery as carefully as for secrecy. An organisation that loses its keys has achieved the same practical outcome as ransomware, using its own tools.
