---
slug: zero-trust-architecture
title: Zero Trust Architecture
source: Internal Security Handbook, Section 5.1
category: architecture
tags: zero-trust, network, segmentation, identity, least-privilege
---

Zero trust is a security model built on the principle that no request should be trusted simply because of where it came from. Every access attempt is authenticated, authorised, and evaluated against current context, whether it originates inside the corporate network or outside it. The slogan often used is "never trust, always verify".

It replaces the perimeter model, in which a firewall separated a trusted internal network from an untrusted internet. That model assumed anything already inside was safe. In practice the perimeter dissolved: staff work remotely, applications live with cloud providers, contractors and suppliers need access, and personal devices connect to corporate services. It also failed against intrusions, because an attacker who got a foothold inside found a flat, trusting network and moved through it freely.

## The core principles

Verify explicitly. Every request is authenticated and authorised using all available signals — user identity, device health, location, the sensitivity of the resource, and unusual behaviour — rather than network position alone.

Use least-privilege access. Grant the minimum permission needed for the task, for the shortest useful time. Just-in-time elevation, where an administrator requests temporary rights that expire automatically, is preferable to standing administrative access.

Assume breach. Design as though an attacker is already inside. Segment networks so that compromising one system does not expose the rest, encrypt traffic between internal services, and monitor continuously rather than only at the boundary.

## What it looks like in practice

Strong identity is the foundation. Zero trust cannot work without reliable authentication, which in practice means phishing-resistant multi-factor authentication and a single well-managed identity provider rather than credentials scattered across systems.

Device posture becomes part of the access decision. A request from a managed laptop with current patches, disk encryption, and a running endpoint agent may be allowed, while the same user on an unmanaged device is limited to read-only access or blocked from sensitive systems entirely.

Micro-segmentation divides the network into small zones with explicit policy between them, so lateral movement requires crossing an enforcement point that can deny and log it. Application-level access replaces broad network access: rather than placing a remote worker on the corporate network with a VPN, a proxy publishes only the specific applications they are entitled to use.

Continuous evaluation matters as much as the initial check. A session that began legitimately may become suspicious if the device falls out of compliance or the behaviour changes, and access should be re-evaluated rather than granted indefinitely.

## Adopting it

Zero trust is a direction rather than a product, and no single purchase delivers it. Vendors market individual components as complete solutions; treat those claims sceptically.

Start by knowing what you have — the identities, devices, applications, and data flows in use. Most organisations discover significant gaps at this stage. Then strengthen identity, since almost everything else depends on it. Next, remove standing privilege and implement application-level access for remote users. Segmentation of the internal network usually comes later because it is the most disruptive.

Expect the work to take years and to change how people do their jobs. The most common failure is technical deployment without process change, leaving broad permissions in place behind a more sophisticated front door.
