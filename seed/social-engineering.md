---
slug: social-engineering
title: Social Engineering
source: Internal Security Handbook, Section 2.2
category: threats
tags: social-engineering, pretexting, manipulation, help-desk, tailgating
---

Social engineering is the manipulation of people into performing actions or revealing information that undermines security. It targets human judgement rather than software, which is why it works against organisations with otherwise strong technical controls. Phishing is the most familiar example, but the technique extends well beyond email.

## Why it works

Attackers exploit reliable features of human behaviour. Authority: people comply with requests that appear to come from someone senior or from an official body. Urgency: a deadline suppresses careful thought. Social proof: "everyone on the team has already done this" lowers resistance. Reciprocity: a small favour creates a sense of obligation. Liking: a friendly, competent-sounding caller is trusted more than a stranger. Fear: a threatened consequence prompts immediate action.

These are not weaknesses of careless individuals. They are the shortcuts that make ordinary cooperation possible, and everyone is susceptible under the right conditions — particularly when tired, busy, or new to a role.

## Common techniques

Pretexting is the construction of a plausible fabricated scenario. The attacker becomes an auditor needing access for a compliance check, an IT technician resolving a fault, or a new supplier updating their bank details. The pretext supplies a reason for the unusual request and a reason not to follow the normal process.

Help desk manipulation targets account recovery. An attacker who knows a target's name, job title, and a few public details calls the service desk claiming to have lost their phone, and asks for the multi-factor authentication to be reset. This bypasses even strong authentication, because the recovery path is often weaker than the front door.

Baiting leaves something tempting for the victim to pick up — historically an infected USB drive in a car park, more often now a free software download or a document that must be opened to view.

Tailgating is physical: following an authorised person through a controlled door, often while carrying boxes or coffee so that holding the door open seems like ordinary courtesy. Impersonating a delivery driver or a contractor achieves the same result.

Quid pro quo offers a service in exchange for cooperation, such as a caller offering to fix a computer problem in return for the user disabling a security tool or installing remote access software.

## Defences

Verification through an independent channel is the most useful single habit. If a request is unusual, contact the person through details you already hold — an internal directory, a number on a prior invoice — rather than the contact details supplied in the request itself.

Design processes so that no single person can be talked into a damaging action alone. Require a second approver for changes to payment details and for privileged access grants. Give the help desk a scripted identity verification standard that is proportionate to the account and that staff are explicitly authorised to enforce against anyone, including executives.

Train with realistic scenarios rather than generic awareness slides, and measure reporting rates rather than click rates alone. A workforce that reports quickly limits damage far more effectively than one that never clicks, which is an unattainable standard in any case.

Above all, make it safe to say no and safe to report a mistake. Attackers depend on the target being too embarrassed or too intimidated to check, and on the victim staying quiet afterwards. A culture where verification is normal and reporting is welcomed removes most of that advantage.
