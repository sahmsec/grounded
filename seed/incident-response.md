---
slug: incident-response
title: Incident Response
source: Internal Security Handbook, Section 6.1
category: operations
tags: incident-response, breach, containment, forensics, recovery
---

Incident response is the organised process a company follows when it discovers it has been breached or attacked. Its purpose is to limit damage, restore normal operation, and learn enough to stop the same thing happening again. The widely used model divides the work into preparation, identification, containment, eradication, recovery, and lessons learned.

## Preparation

Preparation happens before anything goes wrong and determines how well everything else goes. It means having a written plan, a named response team with clear roles, and an out-of-band way to communicate if the corporate email and chat systems cannot be trusted. It means knowing which systems and data matter most, holding current network diagrams and asset inventories, and ensuring logs are actually being collected and retained long enough to be useful.

Rehearse the plan. A tabletop exercise where the team talks through a scenario will expose missing contact details, unclear decision authority, and assumptions about backups that nobody has tested.

## Identification

Identification is confirming that something real has happened and establishing its scope. Alerts arrive from monitoring tools, staff reports, customers, or occasionally law enforcement. The first task is to separate a genuine incident from a false positive, then to determine which systems and accounts are affected and when the activity began.

Resist the urge to start fixing things immediately. Actions taken in the first hour frequently destroy the evidence needed to understand the intrusion, and an incomplete picture leads to partial containment that tips off the attacker without removing them.

## Containment

Containment stops the incident spreading. Short-term containment is immediate and sometimes crude: isolating affected machines from the network, disabling compromised accounts, blocking attacker infrastructure at the firewall. Longer-term containment applies temporary fixes that let the business keep operating while a proper repair is prepared.

Where a company discovers it has been breached, the first practical steps are to isolate the affected systems from the network without powering them off, preserve logs and memory before they are lost, and convene the response team. Powering a machine down discards volatile evidence that may include encryption keys and running processes.

## Eradication and recovery

Eradication removes the attacker's access completely: malware, persistence mechanisms, web shells, unauthorised accounts, and any credentials they may have harvested. Password resets should be comprehensive rather than targeted, because attackers commonly hold credentials nobody realised were exposed.

Recovery restores systems to production, ideally rebuilt from known-good images rather than cleaned in place, and verified before reconnection. Monitor restored systems closely — attackers frequently return, and a re-intrusion shortly after recovery usually means something was missed.

## Lessons learned

Hold a review while memory is fresh. Establish the timeline, identify what allowed the intrusion, and record what worked and what did not. The output should be specific, owned actions with dates, not a general aspiration to improve.

Keep the review blameless. If people fear consequences they report incidents late or not at all, and late reporting is far more damaging than any individual mistake.

## Legal and communication obligations

Many jurisdictions require notification of regulators and affected individuals within a fixed window when personal data is involved, sometimes as short as seventy-two hours. Legal counsel should be involved early. Decide in advance who is authorised to speak publicly, and prepare holding statements — the middle of an incident is a poor time to draft communications.
