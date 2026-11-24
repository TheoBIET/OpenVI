# Security policy

## Supported versions

OpenVI is in early development; only the latest commit on `main` receives fixes.

## Reporting a vulnerability

Please report privately through the repository's **Security → Report a vulnerability** form, not in a public issue.
Include what you found, how to reproduce it, and its impact. You will get an answer within a week.

OpenVI parses large, untrusted binary files, so crashes, hangs or memory blowups caused by a crafted archive are in
scope, as is any way for the UI to reach files outside the folder the user opened.
