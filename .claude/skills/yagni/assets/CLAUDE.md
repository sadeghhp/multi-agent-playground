## YAGNI and change-safety rules

- Implement the current requirement completely, with the least unnecessary complexity. Optimize for the smallest safe, clear, maintainable change — not the fewest lines.
- Before adding a file, class, service, helper, abstraction, or dependency, check whether existing code, a limited extension, the standard library, or an already-installed dependency can meet the requirement instead.
- Do not build features, configuration, extension points, or infrastructure for hypothetical future needs.
- Avoid unrelated refactoring, renaming, file movement, formatting churn, or dependency upgrades outside the current task's scope.
- Before deleting or materially changing existing code, inspect its callers, tests, and consumers. Do not remove code merely because this task doesn't use it.
- Add a dependency only when its present benefit outweighs its maintenance, security, and operational cost.
- Never use YAGNI or simplicity as a reason to weaken correctness, security, input validation, error handling, tests, or backward compatibility — when they conflict, those requirements win.
- Keep process and reporting proportional to risk: a trivial edit gets a light touch; a risky change gets fuller verification.
