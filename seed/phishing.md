---
slug: phishing
title: Phishing
source: Internal Security Handbook, Section 2.1
category: threats
tags: phishing, email, social-engineering, credentials
---

Phishing is an attack in which someone sends a fraudulent message that pretends to come from a trusted organisation or person, with the goal of tricking the recipient into revealing credentials, transferring money, or installing malware. Most phishing arrives by email, but the same technique is used over SMS, phone calls, instant messaging, and social media.

The message impersonates a familiar sender: a bank, a delivery company, a colleague, or an internal system such as a password reset service. It creates urgency — an account will be closed, a payment has failed, a document needs signing — so the recipient acts before thinking. A link leads to a counterfeit login page that captures whatever is typed into it, or an attachment carries malware.

## Common variants

Bulk phishing is sent to very large numbers of recipients with generic wording. It succeeds through volume rather than quality.

Spear phishing targets a specific person and is researched in advance. It may reference a real project, a genuine colleague's name, or a recent event drawn from social media or a company website. It is far more convincing than bulk phishing and correspondingly harder to spot.

Whaling targets executives and finance staff specifically, because those people can authorise payments or access sensitive systems directly.

Business email compromise involves an attacker who has already taken over a real mailbox, or who has registered a lookalike domain, sending payment instructions that appear to come from a supplier or a senior manager. Because the message may come from a genuine account and sit inside a real conversation thread, technical filters rarely catch it.

Smishing uses SMS messages, and vishing uses voice calls, often with a spoofed caller ID. Attackers frequently combine channels: an email that primes the victim, followed by a phone call that appears to confirm it.

## Recognising it

Common signals include a sender address that does not match the display name, a domain with subtle misspellings or an unexpected suffix, links whose visible text differs from their real destination, unexpected attachments, and requests that bypass a normal process. Pressure to act immediately and secrecy — "do not discuss this with anyone yet" — are strong indicators.

Poor spelling used to be a reliable clue and no longer is. Attackers routinely produce fluent, well-formatted messages, and many copy legitimate templates exactly. Judgement should rest on the request itself and the channel it arrived through, not on the polish of the writing.

## Defending against it

Phishing-resistant multi-factor authentication is the single most effective control. Hardware security keys and passkeys using the FIDO2 standard verify the actual website domain during authentication, so a credential captured on a counterfeit page cannot be replayed against the real one. One-time codes from an app or SMS are better than nothing but can still be relayed by an attacker in real time.

Email authentication protocols — SPF, DKIM, and DMARC — make it harder for attackers to spoof your own domain. Configure DMARC to reject rather than merely monitor once you are confident in your sending sources.

Train staff to verify unusual requests through a separate, known-good channel: phone the supplier on the number already on file, not the number in the email. Make it easy and blameless to report suspected phishing, and never punish someone for reporting a false alarm — the cost of a wasted check is far lower than the cost of an unreported click.

Assume some messages will get through. Limit the damage with least-privilege access, monitoring for unusual sign-in locations, and a payment process that requires a second approver for any change to bank details.
