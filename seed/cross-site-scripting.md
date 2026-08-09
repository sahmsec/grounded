---
slug: cross-site-scripting
title: Cross-Site Scripting (XSS)
source: Internal Security Handbook, Section 3.2
category: application-security
tags: xss, owasp, javascript, browser, web
---

Cross-site scripting, usually shortened to XSS, is a vulnerability that lets an attacker run their own JavaScript in another person's browser session. The malicious script arrives as part of a page the victim trusts, so the browser executes it with the full privileges of that site. Anything the legitimate page can do, the injected script can do too.

## The three forms

Stored XSS happens when attacker-supplied content is saved by the application and later shown to other users. A comment field, a profile biography, or a support ticket that accepts HTML and renders it back without escaping will serve the attacker's script to everyone who views it. This is the most damaging form because it can reach many victims without any further action from the attacker.

Reflected XSS happens when input from a request is echoed straight back in the response. A search page that prints "no results for <term>" without escaping will execute a script supplied in the URL. The attacker must persuade the victim to click a crafted link, typically through email or a message, so it is usually combined with phishing.

DOM-based XSS happens entirely in the browser. The server returns a safe page, but client-side JavaScript reads part of the URL or another untrusted source and writes it into the page using something like innerHTML. The dangerous step never touches the server, so server-side filtering does not help and server logs show nothing unusual.

## What an attacker gains

A successful script can read session cookies and send them to a server the attacker controls, allowing them to hijack the session without ever learning the password. It can read anything displayed on the page, including private messages and account details. It can rewrite the page to add a convincing fake login form, or silently submit requests as the victim, such as changing an email address or transferring funds.

Because the script runs on a trusted origin, defences that rely on the origin — including many same-origin protections — do not apply. Multi-factor authentication does not stop it either, since the victim has already completed their sign-in.

## Preventing it

Contextual output encoding is the core defence. Data must be escaped according to where it is being inserted: HTML body, HTML attribute, JavaScript, CSS, and URL contexts each require different treatment. Escaping for the wrong context provides little protection.

Modern templating engines and front-end frameworks escape by default, which eliminates most XSS. The remaining risk concentrates in the deliberate bypasses — functions with names such as innerHTML, dangerouslySetInnerHTML, or v-html. Every use of those should be treated as a security decision requiring justification.

A Content Security Policy adds defence in depth. A policy that disallows inline scripts and restricts which origins may serve scripts means an injected tag often fails to execute even when escaping has been missed. CSP is a safety net rather than a primary control, because a loose policy is easy to write and hard to notice.

Setting the HttpOnly flag on session cookies prevents JavaScript from reading them, which blocks the most common form of session theft. The SameSite attribute reduces the impact of related cross-site request attacks.

If the application genuinely needs to accept rich text from users, sanitise it with a well-maintained library that parses the HTML and rebuilds it from an allow-list of permitted elements and attributes. Hand-written filters that search for the word "script" are bypassed trivially through encoding, unusual event handlers, and malformed markup that browsers helpfully repair.
