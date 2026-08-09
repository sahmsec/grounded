---
slug: multi-factor-authentication
title: Multi-Factor Authentication
source: Internal Security Handbook, Section 4.2
category: identity
tags: mfa, 2fa, authentication, passkeys, fido2
---

Multi-factor authentication, commonly abbreviated to MFA or 2FA, requires more than one independent proof of identity before granting access to an account. It protects an account because an attacker who steals or guesses the password still cannot sign in without the second factor.

The factors are traditionally grouped into three categories: something you know, such as a password or PIN; something you have, such as a phone, a hardware key, or a smart card; and something you are, such as a fingerprint or face scan. Genuine multi-factor authentication combines categories. Two passwords, or a password and a security question, are both "something you know" and therefore add much less protection.

## The methods, from weakest to strongest

SMS one-time codes are the most widely deployed and the weakest. They are vulnerable to SIM swapping, where an attacker persuades a mobile operator to transfer the victim's number to a new device, and to interception in transit. They remain far better than a password alone.

Time-based one-time password apps generate a rotating six-digit code on the device itself, with no message to intercept and no mobile operator to deceive. They resist SIM swapping but not real-time relay: if a victim types a code into a counterfeit login page, an attacker can immediately replay it on the real site during its short validity window.

Push notifications approve a sign-in with a single tap. Convenience is their weakness. Attackers exploit MFA fatigue by triggering requests repeatedly, often late at night, until an irritated or half-asleep user approves one. Number matching, which requires the user to type a digit shown on the sign-in screen, largely defeats this.

Hardware security keys and passkeys built on the FIDO2 and WebAuthn standards are phishing-resistant. The device performs a cryptographic challenge that is bound to the specific website domain. A counterfeit site has a different domain, so the key simply will not produce a valid response. There is no code for a victim to read out or type into the wrong place, which removes the human error entirely.

Passkeys extend the same cryptography to phones and laptops using the built-in biometric sensor, and sync through the platform account. They can replace the password outright rather than supplementing it.

## Deploying it well

Enforce MFA everywhere, particularly on email, remote access, and any administrative console. Email deserves special attention because it is the reset channel for most other accounts — an attacker holding the mailbox can often recover everything else.

Prioritise phishing-resistant methods for administrators and for anyone handling payments or sensitive data. Where hardware keys are impractical for the whole organisation, deploy them to the highest-risk roles first.

Plan the recovery path carefully, because it is usually the weakest link. If a lost device can be replaced by answering a few questions to a help desk, the attacker will simply call the help desk. Require identity verification proportionate to the account's privileges, and log every recovery event for review.

Register at least two factors per user so a lost phone does not lock someone out and create pressure to weaken the process. Monitor for sign-ins that succeed from unexpected locations, and treat repeated declined MFA prompts as a probable attack in progress rather than a user error.
