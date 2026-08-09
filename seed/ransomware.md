---
slug: ransomware
title: Ransomware
source: Internal Security Handbook, Section 2.4
category: threats
tags: ransomware, malware, extortion, backup, recovery
---

Ransomware is malware that encrypts an organisation's files and demands payment for the key needed to decrypt them. Modern ransomware operations almost always steal a copy of the data before encrypting it, then threaten to publish it if the ransom is not paid. This is known as double extortion, and it means that restoring from backup solves the availability problem but not the disclosure problem.

## How an attack unfolds

Initial access usually comes from one of a small number of routes: a phishing email carrying a malicious attachment or link, stolen or guessed credentials on a remote access service exposed to the internet, or an unpatched vulnerability in an internet-facing system such as a VPN appliance or file transfer product.

Once inside, attackers rarely encrypt immediately. They spend time — often days or weeks — moving laterally, harvesting credentials, and identifying the systems whose loss would hurt most. They deliberately seek out backup servers and management consoles, because an organisation that can restore quickly has no reason to pay. Backups are frequently deleted or encrypted first.

Data is then exfiltrated to attacker-controlled storage. Only after that does encryption begin, usually timed for a weekend or a holiday when staffing is thinnest. A ransom note appears with a deadline and a contact address on a hidden service.

Many groups operate a ransomware-as-a-service model, where the software and the payment infrastructure are supplied by one group and the intrusion is carried out by affiliates who take a share. This separation means the technical sophistication of the malware tells you little about the sophistication of the intruder.

## Reducing the risk

Offline or immutable backups are the most important single control. A backup that can be reached and deleted using the same administrator credentials as the production systems is not a backup for ransomware purposes. Keep at least one copy that is offline, in a separate account with separate credentials, or protected by write-once storage. Test restoration regularly — an untested backup is an assumption, not a plan.

Phishing-resistant multi-factor authentication on every remote access point closes the credential route. Prompt patching of internet-facing systems closes the vulnerability route. Network segmentation limits how far an intruder can move once inside, and slows down the encryption stage enough that it may be noticed.

Restrict administrative privileges, and use separate accounts for administrative work so that a compromised everyday account does not immediately grant domain-wide control. Monitor for the behaviour that precedes encryption: mass file access, backup deletion, disabling of security tooling, and unusual outbound data transfers.

## If it happens

Isolate affected systems from the network rather than powering them off, because volatile memory may hold keys and forensic evidence. Activate the incident response plan and the communication tree. Preserve logs before they rotate.

Whether to pay is a business and legal decision, not a technical one. Paying does not guarantee usable decryption, does not guarantee the stolen data is deleted, may be subject to sanctions restrictions depending on the group involved, and funds further attacks. Many organisations that pay still spend weeks rebuilding, because decryption tooling supplied by attackers is often slow and unreliable.

Notify regulators and affected individuals where the law requires it, and engage law enforcement early. They may hold decryption keys recovered from previous operations against the same group.
