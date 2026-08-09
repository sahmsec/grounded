---
slug: security-patching
title: Security Patching and Vulnerability Management
source: Internal Security Handbook, Section 6.4
category: operations
tags: patching, vulnerabilities, updates, exposure, prioritisation
---

Vulnerability management is the continuous process of finding weaknesses in the software an organisation runs, deciding which ones matter, and fixing them before they are exploited. Patching is the most common remedy, but the process is broader than applying updates.

## Why prioritisation is unavoidable

A typical organisation discovers far more vulnerabilities than it can possibly remediate. A scanner may report tens of thousands of findings across an estate. Attempting to fix everything in severity order wastes effort on issues that pose no practical risk while genuinely dangerous ones wait behind them.

Severity scores describe how bad a vulnerability could be in the abstract. They do not describe your exposure. A critical-rated flaw in a component that is not installed, not reachable from the network, or not enabled in your configuration is less urgent than a medium-rated flaw in an internet-facing service that attackers are actively exploiting today.

Prioritise by combining three things: whether the vulnerability is being exploited in the wild, whether the affected system is reachable by an attacker, and what the system would give an attacker if compromised. Public catalogues of known exploited vulnerabilities are a practical source for the first of these, and a vulnerability appearing in one should be treated as urgent regardless of its numeric score.

## Running the process

Maintain an accurate inventory first. You cannot patch what you do not know you have, and unknown systems are consistently the ones that cause incidents. Include cloud resources, containers, network appliances, and developer machines, not only servers.

Scan regularly and from more than one vantage point. An external scan shows what an attacker sees; an authenticated internal scan shows what is actually installed. The two produce very different lists and both are necessary.

Set remediation targets by risk tier and measure against them — for example, actively exploited vulnerabilities on internet-facing systems within days, high severity within weeks, everything else on the routine cycle. Track the ageing of open findings rather than only the count, since a stable count can hide a growing tail of old, unfixed issues.

Test patches before wide deployment, but keep the testing proportionate. An emergency patch for an actively exploited flaw in a perimeter device usually justifies more risk of disruption than a routine monthly update.

## When you cannot patch

Sometimes a patch does not exist yet, or the system cannot be taken down, or the vendor no longer supports the product. Compensating controls buy time: remove the system from the internet, restrict access to a small set of source addresses, disable the vulnerable feature, add monitoring specifically for exploitation attempts, or isolate the host on its own network segment.

Record these decisions with an owner and a review date. Temporary mitigations that are never revisited become permanent, and the organisation loses track of the risk it accepted.

## Software supply chain

Most application code is dependencies, so vulnerability management extends to the libraries you import. Keep a software bill of materials, automate dependency scanning in the build pipeline, and prefer updating regularly over updating rarely — a project that upgrades continuously can apply an urgent security release in minutes, while one that is several major versions behind may need weeks of work at exactly the wrong moment.
