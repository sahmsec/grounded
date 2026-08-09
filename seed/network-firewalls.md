---
slug: network-firewalls
title: Network Firewalls
source: Internal Security Handbook, Section 5.3
category: infrastructure
tags: firewall, network, ports, filtering, segmentation
---

A firewall controls which network traffic is allowed to pass between networks or hosts, according to a configured policy. It is one of the oldest network security controls and remains a foundational one, though its role has narrowed as encryption became universal and applications moved outside the corporate network.

## Types

Packet filters make decisions on individual packets using source and destination addresses, protocol, and port numbers. They are fast and simple but have no memory of previous packets, so they cannot tell a legitimate reply from an unsolicited one.

Stateful inspection firewalls track the state of each connection. Because the firewall remembers that an internal host opened a connection outward, it can allow the matching return traffic while blocking unsolicited inbound attempts. This is the baseline behaviour expected of any modern firewall.

Application-layer firewalls, sometimes called proxies, understand specific protocols and can inspect the content of a session rather than just its envelope. A web application firewall is a specialised example that inspects HTTP requests for attack patterns such as SQL injection or cross-site scripting payloads.

Next-generation firewalls combine stateful inspection with application identification, user identity awareness, and intrusion prevention, allowing rules expressed in terms of applications and user groups rather than only addresses and ports.

Host-based firewalls run on individual machines. They matter more than they used to, because they enforce policy regardless of which network the device is connected to, and they restrict traffic between hosts that sit on the same network segment.

## Writing a good policy

Default deny is the essential principle. The final rule should block everything not explicitly permitted. A policy that allows everything except a list of known-bad destinations will always be incomplete.

Be specific. A rule permitting a single source to reach a single destination on a single port is far more useful than one opening a wide range to any address. Broad rules accumulate over years and quietly become the path an intruder uses.

Document why each rule exists and who owns it. Undocumented rules are never removed, because nobody dares. Review the rule set regularly and remove entries whose purpose has ended; large estates commonly find that a substantial fraction of rules are obsolete or entirely shadowed by others.

Restrict outbound traffic as well as inbound. Egress filtering is frequently neglected, yet it is what limits an intruder's ability to reach command-and-control infrastructure or move stolen data out.

Log denied traffic and review it. Repeated denials from an internal host often indicate misconfiguration, but sometimes indicate malware attempting to call home.

## Limitations

A firewall cannot inspect encrypted traffic without terminating and re-encrypting it, which brings privacy and certificate-handling complications. Almost all traffic is now encrypted, so the visibility a firewall once provided has diminished considerably.

It also cannot help against traffic that never crosses it. A laptop compromised at home, a service reached directly from a phone, or an attack between two machines on the same segment all bypass a boundary firewall entirely. This is a large part of why segmentation and host-based controls have grown in importance relative to the perimeter.
