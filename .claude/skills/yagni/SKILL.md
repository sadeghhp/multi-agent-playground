---
name: yagni
description: "Apply YAGNI and change-safety discipline: implement the smallest complete change, reuse existing capabilities before adding new ones, and avoid speculative abstractions, dependencies, or unrelated refactors — without weakening correctness, security, tests, or compatibility. Use for any task that writes, fixes, refactors, reviews, or designs code, chooses dependencies or architecture, or asks for less over-engineering. Also use to install persistent YAGNI rules into a project's CLAUDE.md."
---

# Algotic YAGNI

Implement the current requirement completely with the least unnecessary complexity. Do not optimize for the fewest lines of code; optimize for the smallest safe, clear, maintainable change.

## Select the mode

- For an implementation request, inspect, plan briefly, implement, verify, and report in the same task.
- For a review or audit request, report concrete over-engineering risks and simpler alternatives without editing unless the user asks for changes.
- For a question, diagnosis, or planning-only request, answer that request without treating the skill as authorization to modify files.
- For persistent project rules, install or merge `assets/CLAUDE.md` into the target repository as described below.

## Apply the workflow

1. Inspect the relevant repository instructions, code, tests, configuration, architecture, dependencies, and current worktree state.
2. Identify the explicit present requirement, existing behavior, affected contracts, and verification needed.
3. Check whether the requirement can be met, in order, by:
   - Reusing existing project code.
   - Making a limited extension to an existing component.
   - Using the language standard library.
   - Using built-in framework, browser, operating-system, or platform capabilities.
   - Using a dependency already installed in the project.
4. Choose the smallest effective change that fully satisfies the requirement and fits the existing architecture.
5. Implement only the necessary scope.
6. Run focused checks first, then broader checks when the change's risk or repository conventions justify them.
7. Report the result, actual verification, and any material unresolved risk.

## Control implementation scope

- Do not build features, configuration, extension points, fallback modes, or infrastructure for hypothetical future needs.
- Create a file, class, service, helper, interface, abstraction, dependency, or architectural layer only when this task genuinely requires it.
- Do not introduce plugin systems, event buses, factories, registries, adapters, wrappers, or generic frameworks for a single focused use case unless the current architecture requires that pattern.
- Avoid unrelated refactoring, cleanup, renaming, file movement, formatting churn, dependency upgrades, or rewrites.
- Preserve established architecture, conventions, public contracts, and externally visible behavior unless the task explicitly requires a change.
- Before deleting or materially changing existing code, inspect its references, callers, tests, configuration, and consumers. Do not remove code merely because the current task does not use it or because deletion makes the diff shorter.
- Do not use clever compression, unsafe hardcoding, duplicated logic, silent failure, or fragile shortcuts to reduce code volume.
- Preserve unrelated user changes in a dirty worktree. Never overwrite, revert, or clean them up as part of this task.

## Evaluate dependencies and infrastructure

- Before adding a dependency, verify that current code, the standard library, the framework, the platform, or an existing dependency cannot provide a secure and maintainable solution.
- Add a dependency only when its present benefit outweighs its maintenance, security, and operational cost.
- Do not change lock files, global configuration, dependency versions, environments, build systems, pipelines, public APIs, database schemas, or infrastructure unless directly required.
- When a schema or public contract must change, preserve data and compatibility where possible and follow the repository's migration conventions.
- Never perform destructive data or infrastructure operations without explicit user authorization.

## Preserve safety and quality

Never use YAGNI, simplicity, or code reduction to remove, weaken, skip, or bypass relevant:

- Correctness or data integrity.
- Security, privacy, authentication, or authorization controls.
- Input validation or output encoding.
- Error handling, recovery behavior, or required edge cases.
- Essential logging, auditing, or observability.
- Type safety, accessibility, reliability, or concurrency safety.
- Backward compatibility or public contracts.
- Necessary tests and meaningful verification.
- Readability, maintainability, explicit requirements, or acceptance criteria.

## Review unnecessary complexity

When asked to review a diff, design, dependency, or repository for YAGNI violations:

1. Inspect the actual code and usages before judging the design.
2. Identify only concrete complexity that is unsupported by current requirements.
3. For each finding, explain the cost, the current evidence, and the smallest viable alternative.
4. Distinguish a confirmed unnecessary layer from a legitimate architectural tradeoff.
5. Do not recommend removing safety controls, tests, compatibility, or established abstractions solely to reduce size.
6. Lead with actionable findings and file references; say clearly when no material YAGNI issue is found.

## Install persistent Claude rules

Use `assets/CLAUDE.md` when the user asks to add permanent YAGNI rules to a Claude Code project.

1. Inspect all applicable existing `CLAUDE.md` files and their scope before editing.
2. If the project has no root `CLAUDE.md`, copy the template to the repository root.
3. If one exists, merge the YAGNI rules into it without deleting or weakening current project instructions.
4. Resolve conflicts in favor of explicit user requirements and repository-specific safety rules.
5. Avoid duplicating an existing equivalent YAGNI section.
6. Explain that the installed Skill is available across projects, while `CLAUDE.md` makes the behavior persistent for that repository.

## Complete proportionally

Keep process and reporting proportional to risk. For a trivial edit, inspect enough to act safely, make the change, run a focused check if available, and report concisely. Do not add a speculative backlog of future enhancements.
