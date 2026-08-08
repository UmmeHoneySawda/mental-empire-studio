# Product

<!-- impeccable:product-schema 1 -->

> Repository-derived product record. The user explicitly requested autonomous inference from the existing product and codebase on 2026-08-08.

## Platform

web

## Users

Independent faceless-YouTube creators and small channel operators who manage repeatable production across one or more channels from a desktop workstation. Their core job is to move source videos through acquisition, composition, thumbnail creation, rendering, and publication without losing track of what is ready or what needs attention.

## Product Purpose

Mental Empire Studio is a creator-grade desktop studio for running the complete faceless-YouTube production workflow. Success means a creator can understand the state of every video, take the correct next action, and automate routine channel work while retaining local control of media, settings, and output.

## Positioning

The product joins source monitoring, channel mapping, downloading, composition, captions, thumbnails, rendering, and repeatable automation in one local-first workflow. It does not require a cloud account and keeps the creator's production data and media on their machine; only optional media or model providers require keys.

## Operating Context

- Creators work across source channels, owned channels, local audio, images, stock media, captions, thumbnails, and rendered video files.
- Work moves through a connected production path: monitor or select a source, download material, compose and review the video, create its thumbnail, render it, then confirm publication.
- Long-running downloads, transcription, automation, and renders may continue in the background or system tray and must expose progress, failures, and recovery actions.
- Weekly channel goals, new-source signals, queued work, and output readiness compete for attention; the interface must make the next useful action obvious.

## Capabilities and Constraints

- Electron, React, TypeScript, Zustand, and SQLite form the existing desktop application stack.
- The app supports source and owned-channel management, source-to-channel mapping, downloads, multiple video composition engines, word-level captions, thumbnail editing, render queues, profiles/templates, scheduled automation, and application settings.
- The product is local-first. Cloud accounts and cloud storage are not product requirements; optional provider keys may enable transcription, stock media, or model-backed assistance.
- Existing creator data, media paths, automation settings, encrypted keys, and working production behavior must remain intact through interface changes.
- User-facing terminology should describe stages in the production workflow and avoid exposing implementation details unless they affect an intentional advanced choice.

## Brand Commitments

- Product name: Mental Empire Studio.
- Voice: direct, capable, creator-oriented, and operational. Copy should explain outcomes and next actions without hype.
- The application is presented as professional production software, with the level of clarity and control users expect from established desktop creative tools.

## Product Terminology

- **Publishing channel**: a channel the creator owns and publishes finished videos to.
- **Source channel**: a channel whose videos supply material for new productions.
- **Video Studio**: the editing stage for captions, media, motion, and visual treatment.
- **Production template**: reusable automation settings for format, captions, motion, and visual treatment.
- **B-roll collection**: a topic-specific set of locally cached stock clips in the B-roll library.
- **Ready to Upload**: a finished render that Studio has prepared for the creator to upload manually.

## Evidence on Hand

- [`README.md`](README.md) documents the implemented product scope and local-first position.
- [`PLAN.md`](PLAN.md) records completed implementation milestones.
- The working React screens and Electron services are the authority for current capabilities.
- No testimonials, customer logos, usage benchmarks, or external proof claims are present; future interface work must not fabricate them.

## Product Principles

1. Treat every feature as part of one production journey and preserve context between stages.
2. Make status, blockers, and the next useful action apparent before presenting secondary controls.
3. Keep routine paths simple while preserving deliberate access to advanced production controls.
4. Keep creator data and media local by default and make external-provider boundaries explicit.
5. Automate repetition without hiding progress, failure recovery, or user control.
