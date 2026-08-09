---
slug: sql-injection
title: SQL Injection
source: Internal Security Handbook, Section 3.1
category: application-security
tags: injection, owasp, database, web
---

SQL injection is a vulnerability that lets an attacker tamper with the database queries an application sends to its database. It happens when untrusted input from a user is joined directly into a query string instead of being passed as a separate parameter. The database cannot tell the difference between the query the developer intended and the extra instructions the attacker supplied, so it executes both.

A classic example is a login form that builds a query by string concatenation. If the application constructs `SELECT * FROM users WHERE email = '<input>'` and the attacker types `' OR '1'='1` into the email box, the resulting query asks the database for every row in the users table. The condition is always true, so the application may treat the attacker as an authenticated user.

## What an attacker can do

The impact depends on the permissions of the database account the application uses. In the worst case an attacker can read every record in the database, including password hashes, personal data, and payment details. They can modify or delete records, escalate their own privileges, and in some configurations run operating system commands on the database server.

Attackers also use injection to extract data indirectly. Blind SQL injection is used when the application does not display query results. The attacker asks true or false questions and infers the answer from small differences in the response, such as whether a page renders normally or how long the request takes to complete. This is slower but just as effective, and it is much harder to spot in logs.

Union-based injection appends a second query to the first using the UNION operator, so results from an unrelated table appear inside the normal page output. Error-based injection deliberately provokes database errors that leak table and column names in the error text.

## How to prevent it

Parameterised queries, also called prepared statements, are the primary defence. The query structure is sent to the database first and the user input is sent separately as data. Because the database already knows the shape of the query before it sees the values, input can never change the meaning of the statement. Every mainstream language and database driver supports this, and it is almost always simpler than building strings by hand.

Object-relational mappers generally use parameterised queries by default, but they usually offer a raw query escape hatch. Those escape hatches are where injection tends to reappear in otherwise safe codebases, so raw query calls deserve extra review.

Input validation is a useful second layer but never a substitute for parameterisation. Allow-list validation, where the application accepts only values matching a known-good pattern, is stronger than block-list validation that tries to strip dangerous characters. Attackers have many encodings available and block lists are routinely bypassed.

Apply least privilege to the database account. An application that only needs to read from three tables should not be connecting as an administrator. This does not prevent injection, but it sharply limits what a successful attack can reach.

Stored procedures help only if they themselves use parameters internally. A stored procedure that concatenates its arguments into dynamic SQL is just as vulnerable as application code that does the same thing.

## Detecting it

Web application firewalls can block common injection payloads, which is useful for buying time, though determined attackers can often evade signature matching. More reliable signals come from the application itself: log unusual query errors, monitor for sudden spikes in result set sizes, and alert on database accounts running statements they have never run before.

Automated scanners find the obvious cases during testing. Code review focused specifically on where queries are constructed finds the cases scanners miss, particularly in administrative tooling and reporting features that receive less attention than the main user-facing application.
