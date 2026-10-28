---
name: devcentral-ai-rule
description: Use when writing or drafting articles for F5 DevCentral. Applies DevCentral community style rules to avoid AI-generated tells, enforce practitioner tone, and produce articles that readers trust and share.
---

# DevCentral Article Writing

## Overview

DevCentral readers are practitioners. They spot AI-generated content and dismiss it. This skill enforces the writing rules that keep articles credible.

**Core principle:** Every paragraph must contain something only you know. If it could sit in anyone's article about any product, rewrite it.

## When to Use

- Drafting a DevCentral technical article
- Editing an existing draft for DevCentral submission
- Reviewing article text for AI tells before publishing
- Translating or rewriting technical content for DevCentral audience

## Article Structure

1. **Title**: Short, specific. Name what you built or fixed.
2. **Subtitle**: One line — what the reader gets from reading this.
3. **The problem**: What were you trying to do, what got in the way. Name it concretely.
4. **Your setup**: The config you run, the version you're on, the output you got.
5. **What you did**: Walkthrough with real configs, real outputs, real commands.
6. **What went wrong**: The error you hit, the thing you tried first, the dead end.
7. **Result**: What it looks like working. Show it.
8. **Lessons learned**: Numbered, specific. What you know now that you didn't before.
9. **What's next**: Optional. Future work, areas to explore.
10. **Try it yourself**: Repo link, prerequisites, quick-start commands.

## Banned Patterns — AI Tells

These get your article dismissed. Check every draft against this list.

| Pattern | Why it fails | Fix |
|---|---|---|
| Em dashes everywhere | Most common AI tell | Use a full stop or comma instead |
| "It's not just X, it's Y" | Hollow emphasis | Say what it is, plainly |
| Buzzwords: seamless, robust, leverage, unlock, empower, ensures | Empty filler | Say what actually happens: "keeps serving when a backend stalls" |
| Throat-clearing openers: "In today's ever-evolving threat landscape..." | Reader stops reading | Start with the problem |
| Announced build-up: "Here's the thing." "Let's dive in." "The result?" | Padding | Just say it |
| Slogan endings: "Fewer alerts to triage. More of them worth triaging." | Sounds like marketing | One plain sentence about what happens |
| Everything in threes: "Faster, safer, and more resilient" | AI cadence | Two specific things beat three vague ones |
| "Consider separating your workflows" | Generic advice | "Here's the pipeline job we use, and why we split it" |

## Voice Rules

- **First person, past tense for what you did.** "I built", "I found", "I hit this error."
- **Show your own setup.** Real IPs, real namespaces, real outputs. Redact secrets, keep everything else.
- **Include what went wrong.** Practitioners trust the article that admits a dead end.
- **No hedging.** Don't write "you might want to consider." Write "do this" or "I did this."
- **Plain sentences.** Subject, verb, object. If a sentence has three clauses, split it.

## Code Blocks

- Real commands the reader can run, not pseudocode.
- Include the output you got.
- If a command needs context (env vars, paths), show them.
- If you used curl, show the full curl. If you used CLI, show the CLI.

## Self-Check Before Submitting

Read every paragraph and ask:

1. Could this paragraph appear in someone else's article about a different product? If yes, rewrite it with something only you know.
2. Does this sentence contain an em dash? Replace it with a period or comma.
3. Does this sentence start with a build-up phrase? Delete the build-up, start with the content.
4. Does this use a buzzword from the banned list? Replace with what actually happens.
5. Would I say this sentence out loud to a colleague? If not, rewrite it.

## AI Attribution

If AI helped write the article, add a line at the end stating what it did:

- "Drafted with help from AI, then tested and edited by the author."
- "Translated from the author's original language with help from AI."

Be specific about what the AI did so readers know what they're reading.

## Quick Reference — Good vs Bad

| Bad | Good |
|---|---|
| "In today's rapidly evolving cloud landscape, security is paramount." | "We needed to block SQL injection on our XC load balancer without writing custom rules." |
| "The platform seamlessly integrates with Azure Sentinel." | "F5 XC streams WAF events to Azure Event Hub. An Azure Function picks them up and writes them to Log Analytics." |
| "This robust solution ensures comprehensive protection." | "The WAF blocked all 9 test payloads. The events showed up in Sentinel 5 minutes later." |
| "Consider leveraging the MCP server to unlock new possibilities." | "Clone the repo, set your API token, run npm start. The 39 tools show up in Claude Code immediately." |
