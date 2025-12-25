<!--
Sync Impact Report
==================
Version change: N/A → 1.0.0 (initial ratification)
Modified principles: N/A (initial)
Added sections:
  - Core Principles (2 principles)
  - Governance
Removed sections:
  - [SECTION_2_NAME] (unused - no additional constraints needed)
  - [SECTION_3_NAME] (unused - no separate workflow section needed)
  - Principles 3-5 (user specified only 2 principles)
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ (Constitution Check section compatible)
  - .specify/templates/spec-template.md ✅ (no changes needed)
  - .specify/templates/tasks-template.md ✅ (no changes needed)
Follow-up TODOs: None
-->

# Slack MCP Server Constitution

## Core Principles

### I. Simplicity Over Complexity

All implementations MUST favor the simplest solution that meets requirements.

- Any added complexity MUST be explicitly justified in writing
- If a simpler alternative exists, it MUST be documented why it was rejected
- Default to fewer abstractions, fewer layers, fewer files
- "Simple" means: fewer moving parts, easier to understand, less to maintain

**Rationale**: Complexity compounds over time. Unjustified complexity creates
maintenance burden, slows development, and obscures intent.

### II. Human-Reviewable Outputs

All artifacts produced during spec-kit development MUST be reviewable by a human
in a single sitting.

- Scope of work MUST NOT be too broad to review in one pass
- Code changes MUST NOT exceed what a reviewer can meaningfully assess
- Specification documents MUST be concise enough to read and validate
- If output exceeds reviewable size, it MUST be split into smaller increments

**Rationale**: Unreviewed work is untrusted work. Large outputs bypass human
judgment, increasing risk of errors, misunderstandings, and drift from intent.

## Governance

This constitution supersedes all other practices and guidelines in this project.

**Amendment Procedure**:
1. Proposed changes MUST be documented with rationale
2. Changes require explicit approval before adoption
3. All amendments MUST include a migration plan for affected artifacts

**Versioning Policy**:
- MAJOR version: Principle removal or incompatible redefinition
- MINOR version: New principle added or materially expanded guidance
- PATCH version: Clarifications, wording, typo fixes

**Compliance Review**:
- All PRs and reviews MUST verify compliance with these principles
- Violations MUST be flagged and resolved before merging
- Use the Complexity Tracking table in plan.md to justify any necessary violations

**Version**: 1.0.0 | **Ratified**: 2025-12-25 | **Last Amended**: 2025-12-25
