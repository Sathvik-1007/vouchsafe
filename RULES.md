# Non-Negotiable Rules

These rules apply to ALL code in this project. No exceptions. No "just this once." No "it's just a prototype."

---

## The Vision

**We are building the best possible software. Not "a good implementation." Not "a competitive one." THE BEST.**

This is not arrogance. This is engineering discipline. Every project that exists today was built by teams who accepted compromises — "good enough for shipping," "we'll fix it later," "nobody will notice." We accept NONE of those compromises. Every line of code exists because it is the BEST possible implementation of that functionality. Not the fastest to write. Not the easiest to understand. THE BEST.

We will never say good enough. We will say PERFECT or NOT DONE YET.

**What "best of the best of the best" means in practice:**
- Every state machine handles every input correctly — not just common inputs
- Every operation works for every edge case — not just the ones typically encountered
- Every output is correct — not just "close enough"
- Every optimization is measured and proven — not just "should be faster"
- Every connection between subsystems is seamless — not just "it works if you don't look too closely"

**We write ALL code ourselves, from input to output. A to Z. Every connection smooth. Every subsystem perfect. Every edge case handled.**

---

## The Doctrine

**This project is built from the ground up, A to Z, to be the best of the best of the best.**

- Every line of code is OURS — written by us, connected by us, perfected by us
- No attaching parts from other projects blindly. No copying implementations. No wrapping existing engines.
- Every connection between subsystems is smooth, intentional, and perfect
- A to Z means: from input to output, every step is our code, our design, our quality
- "Best of the best of the best" is not hyperbole — it is the engineering standard
- No hardcoding. No simplification. No minimization. Full spec. Full correctness. Full performance.
- Every issue is solved to SSS grade or it is NOT solved
- Agents DO NOT STOP until all issues in a file are SSS and struck through
- There is no "good enough". There is only "perfect per spec" or "not done yet"

**"Above all, don't lie to yourself."** — If the code is bad, say it's bad. If a design is wrong, say it's wrong. If you don't know something, say you don't know. Never produce confident-sounding output that masks ignorance. Never satisfy the author at the expense of truth. The moment we start lying to ourselves about quality is the moment this project dies.

---

## Execution Philosophy — SSS First, Aim EX

### No Versioning Mindset

- There is no "v1", "v2", "Phase 1 acceptable", "good enough for now", "we'll improve later"
- The plan we write IS the final plan. Not a draft. Not an iteration. THE PLAN.
- Every implementation is the FINAL implementation. Not a prototype. Not a stepping stone.
- If you catch yourself thinking "this is acceptable for Phase 1" — STOP. There are no phases of quality. There is only SSS or NOT DONE.
- "We'll refactor later" is a lie. Do it right NOW or don't do it.

### No Time Constraints as Excuses

- NEVER say "this will take 1-2 weeks so let's simplify"
- NEVER say "given time constraints, we'll do minimal"
- NEVER use time as a reason to reduce quality
- NEVER assume how long something takes — time is irrelevant to correctness
- The work takes as long as it takes to be SSS. Period.
- If something is complex, that means PLAN MORE, not DO LESS.

### No Minimal Editing Cop-Outs

- NEVER say "this is complex so I'll only do minimal changes"
- NEVER limit scope because the task feels large
- NEVER do partial work and call it done
- If a plan needs 50 files changed, change 50 files
- If a rule needs to be written in 3 places, write it in 3 places
- The scope of work is determined by what SSS REQUIRES, not by what feels comfortable

### SSS at First Try — Plan, Then Execute Perfectly

**The execution model is: PLAN → VERIFY PLAN → EXECUTE TO SSS → AIM FOR EX**

1. **PLAN**: Before touching code, plan the ENTIRE implementation. Every file, every function, every edge case, every test. The plan is SSS-complete — it covers everything needed for SSS grade.
2. **VERIFY PLAN**: Web-search every dependency, every API, every version. Read docs. Confirm assumptions. The plan must be VERIFIED before execution begins. No "I think this API exists" — CONFIRM it exists.
3. **EXECUTE TO SSS**: Implement the plan in full. Not partially. Not "the important parts." ALL of it. First try. The goal is SSS on the first pass.
4. **AIM FOR EX**: After SSS is achieved, look for EX opportunities. Can the algorithm be better? Can the data structure be more cache-friendly? Can we eliminate allocations? Push toward EX.

**The sequence is ALWAYS: SSS first, then push toward EX.**
**NEVER: "Let's get it working first (B grade) and then improve (maybe A, maybe S, maybe never)."**

### Verification Before Execution

- Before writing ANY code, web-search for:
  - Latest package/crate/dependency versions
  - Current API signatures (not from memory)
  - Compatibility between dependencies
  - Best practices and patterns for the specific problem
- NEVER write code based on assumptions about APIs, versions, or behavior
- NEVER cite "time constraints" as a reason to skip verification
- If you cannot verify something, DOCUMENT THE ASSUMPTION explicitly
- The cost of verifying: seconds. The cost of assuming wrong: hours of debugging, broken builds, wasted sessions.

### Planning Rules

- When we plan work, the plan targets SSS as the MINIMUM outcome
- Every plan item includes: what SSS means for that item, what EX would look like
- Plans do not have "stretch goals" — everything in the plan is MANDATORY
- Plans do not have "nice to haves" — if it's in the plan, it ships
- Plans are verified against reality (web-search, docs, source code) before execution begins
- A plan that says "if time permits" is a BAD PLAN. Remove the conditional. Either it's in scope or it's not.

---

## Rule Zero: NEVER ASSUME — ALWAYS VERIFY

This is the single most important rule in the entire project. It applies to EVERYTHING:

**If you do not know a fact with 100% certainty, you MUST verify it before using it.**

This includes but is not limited to:
- **Package/dependency versions** — ALWAYS web-search for the latest version. Never use a version from memory or training data. Packages evolve constantly; a version that existed 6 months ago may be yanked or superseded.
- **API signatures** — If you're unsure whether a function exists or what its signature is, look it up. Read the actual source or docs.
- **Spec compliance** — If you claim something is "per spec," cite the spec section. If you can't cite it, you don't know it.
- **Platform behavior** — If you're unsure whether a syscall/library/tool exists on the target platform, check. Don't assume.
- **Compiler/toolchain behavior** — If you're unsure whether the toolchain supports a feature, verify it. Don't assume based on older knowledge.
- **Performance claims** — If you claim something is "faster," prove it with a benchmark. No handwaving.
- **Dependency compatibility** — If you're combining packages, verify they're compatible (same runtime versions, no conflicting features).
- **Error behavior** — If you're unsure what an API returns on error, read the source. Don't guess.

**The cost of verifying: seconds. The cost of assuming wrong: hours of debugging, broken builds, security holes.**

**How to verify:**
1. Web search for current state (package versions, API changes, deprecations)
2. Read actual source code / official documentation
3. Use package manager search/info commands
4. Test with a minimal example if still unsure
5. If verification is impossible (offline, no docs), explicitly document the assumption: `// ASSUMPTION: [package] exports [API]. Verify.`

**Violations of this rule are graded as FAILURES regardless of other code quality.**

---

## Grade Scale

Code quality is graded D < C < B < A < S < SS < SSS < EX. **Minimum acceptable = SSS.**

### C — Exists But Broken
- Code compiles/runs but has known bugs or crashes
- Missing major functionality (stubs, TODOs, placeholder implementations)
- No tests or tests that don't assert correctness
- Hardcoded values, magic numbers, no configuration
- Would fail basic usage scenarios

### B — Functional But Incomplete
- Core happy path works
- Some edge cases handled, many missed
- Basic tests exist but coverage < 50%
- Some hardcoding remains
- Would work for demos but fail in production

### A — Good But Not Great
- All common cases handled correctly
- Tests cover happy paths and major edge cases
- No hardcoding, configurable where needed
- Compiles/runs clean (no warnings)
- Would pass a code review at a good company

### S — Strong
- All spec-required behavior implemented
- Edge cases handled with proper error recovery
- Test coverage > 80% including error paths
- Performance considered (no O(n²) where O(n) exists)
- Integration with adjacent subsystems working

### SS — Excellent
- Full spec compliance (can cite spec sections)
- All edge cases handled including adversarial inputs
- Property tests and fuzz targets exist
- Performance optimized for common paths
- Zero crashes, graceful degradation on all errors
- Cross-module integration seamless

### SSS — Production Perfect (minimum acceptable)
- Zero crashes, zero silent failures, zero corner cases missed
- Every constant configurable, every limit bounded
- Full spec compliance with spec citations
- All edge cases handled with tests
- Optimized data structures where appropriate
- Feature flags on every subsystem
- All public APIs documented
- Linter clean, strict safety rules enforced
- Property tests for parsers, fuzz targets for entry points, benchmarks for hot paths
- Cross-module types unified (single source of truth)
- Integration wired and working end-to-end
- **SSS = robust + correct + complete.**

### Grades Below SSS (not acceptable for merge)
- **A–SS**: Good code with minor gaps. Fix before merge.
- **B–C**: Significant issues. Rewrite or major refactor needed.
- **D**: Broken. Discard.

### EX — The Pinnacle

EX is not a checklist you tick off. EX is the **absolute peak of software engineering** — the level where every line of code exists for a reason measurable in nanoseconds, cache lines, or branch mispredictions. Algorithm, architecture, data structure, and micro-optimization are ALL required, simultaneously, without compromise.

EX means this code could be published in a systems paper. EX means a senior engineer reads it and nods. EX is what happens when you refuse to accept "good enough" at any level of abstraction.

**Everything in SSS, PLUS all of the following, without exception:**

#### The Greatest Optimizations Applied

**Algorithm-Level Mastery**
- Every algorithm is the best known for its problem class — not "good enough," THE BEST
- O(n log n) where O(n²) would "work fine." O(1) amortized where O(log n) is "acceptable"
- Dynamic programming where recursion would "be simpler"
- No brute-force anywhere. If a better algorithm exists, use it
- Fast paths for common cases, correct paths for all cases
- Algorithmic complexity documented on every significant function

**Custom Data Structures**
- Hand-rolled arena allocators tuned to access patterns (bump arenas, typed arenas, pool allocators)
- Custom data structures where standard library containers are suboptimal
- Interned string tables with generation tracking (not just hash maps)
- Bit-packed structs: every bit accounted for, zero padding waste
- Cache-line-aligned structures for concurrent hot paths
- SoA (struct-of-arrays) layouts where AoS causes cache misses
- Custom small-size-optimized containers for known-small-N cases

**CPU/Hardware-Level Optimization**
- **SIMD everywhere applicable**: math operations, geometry, string scanning — process 4-16 elements per instruction
- **Branchless programming on hot paths**: replace `if` with arithmetic/bitwise ops. Branchless min/max, conditional select, predicated stores
- **Cache locality as religion**: sequential access patterns, prefetch hints for known traversals, data packed to minimize cache lines touched, hot/cold splitting
- **Loop unrolling** where the compiler doesn't: manual 4x/8x unroll for SIMD-width operations
- **Zero-copy everything**: borrowed slices, no intermediate allocations, parse-in-place, memory-mapped I/O
- **Lock-free concurrent structures** where contention exists: atomic operations, epoch-based reclamation, hazard pointers
- **Custom allocator per subsystem**: each tuned to its allocation pattern
- **Prefetch hints** for known sequential/strided access patterns

**Architectural Innovation**
- Incremental computation everywhere — not just dirty flags, self-adjusting computation
- Parallel pipelines where data deps allow
- GPU-accelerated compute for batch operations
- Work-stealing thread pool with affinity hints
- Zero-alloc hot paths verified by allocator instrumentation
- Pipeline stages designed so each fits in L2 cache working set

**Verification & Proof**
- Formal invariant documentation: pre/post conditions on every significant function
- Allocation-free proof: hot paths benchmarked with counting allocator, zero allocs verified
- Cache miss profiling: perf numbers documented for critical paths
- Fuzzing coverage ≥ 90% of parser branches
- Property tests with shrinking on all data structures
- Benchmark regressions block merge — tracked in CI

**Integration Perfection**
- Every subsystem boundary is zero-copy or single-copy — no serialization tax
- No type duplication across module boundaries — canonical types in shared modules
- Event pipeline end-to-end latency measured and tracked in benchmarks
- Memory fragmentation measured and bounded per allocator
- All subsystems independently toggleable, graceful degradation verified by tests

**The Optimization Commandments**

Optimization is not a licence to destroy. Every optimization MUST obey these rules:

1. **ALL edge cases still pass.** If an optimization breaks ANY edge case — NaN, empty input, overflow, Unicode, zero-length, max-size, negative, concurrent — it is not an optimization. It is a regression. No exceptions.

2. **Functionality is sacred.** Never sacrifice a feature for speed. Never hardcode a constant to "skip the slow path." Never remove a branch because "that case is rare." If the spec says handle it, we handle it — fast.

3. **Readability scales with cleverness.** The more clever the optimization, the MORE documentation it needs. If a future engineer can't understand it in 5 minutes with the comments, it's not ready.

4. **Benchmarks are the proof.** Every optimization has a before/after benchmark committed alongside it. "Should be faster" is not acceptable. Measure it. Show the numbers. If the benchmark shows < 5% improvement on the hot path, the complexity isn't worth it.

5. **Optimizations are additive, not destructive.** The optimized path handles EVERY case the unoptimized path handled. Fast paths for common cases are fine — but the slow path for uncommon cases must still exist and still be correct.

6. **No magic numbers baked in.** Constants remain named, documented, and configurable. If the optimal value depends on hardware, make it a compile-time const with a doc comment explaining the tuning.

7. **Tests increase, not decrease.** After optimization, there must be MORE tests than before. Never reduce test coverage to make an optimization "work."

---

## The Iron Laws

### 1. No Hardcoding
- Every constant has a name, a doc comment, and a reason to exist
- Every limit is configurable (compile-time const or runtime config)
- No magic numbers. No string literals for behavior. No embedded paths.
- If it might change, it's a constant. If it might vary per-user, it's a config.

### 2. No Simplification
- Implement the spec, not a subset of it
- Handle every edge case the spec describes
- If the spec says "must", we must. If it says "should", we should.
- No "good enough for now" — either do it right or don't do it yet

### 3. No Minimalization
- Don't skip error paths. Don't ignore unlikely branches.
- Every branch/match has every arm. Every error type is handled.
- Every loop has a termination proof (cap or convergence).
- Every allocation has a size check.

### 4. No Unsafe Code
- Forbid unsafe code in every module/package
- Only exception: allocator setup in the binary entry point
- If you think you need unsafe, you need a different design
- FFI boundaries get their own dedicated wrapper modules with minimal, audited unsafe

### 5. No Crashes from User Input
- All parsing paths use fallible APIs
- All operations return success indicators
- All processing paths have depth/size caps
- Unwrap/expect only on invariants proven by construction — never on external data
- Panic only in unreachable codepaths with a proof comment

### 6. No Silent Failures
- Every error is either handled and recovered, or logged and propagated
- No empty catch blocks. No discarded results without a comment.
- Degradation is explicit: if we skip processing, log why
- Every must-use return value is checked

### 7. No Lies
- If the code has a known limitation, document it. Don't hide it.
- If a TODO exists, it has an issue number and a reason.
- If a test is skipped/ignored, the comment says why and when it should be un-ignored.
- If performance isn't measured, don't claim it's "fast." Measure it. Post numbers.
- If you're unsure whether something is correct, say so in a comment. Don't ship uncertainty disguised as confidence.
- Comments describe WHAT IS TRUE, not what you wish were true.
- "Works on my machine" is not a test. CI is a test.

---

## Code Organization Rules

These exist because we refuse to be another "vibe coded for 6 months, codebase is a disaster" project. Structure is not optional. Structure is what separates engineering from hacking.

### Module/Package Structure (mandatory)
- Entry point file contains public API surface only — re-exports and module declarations
- One concept per file. Named for what it IS, not what it does.
- Group related modules. Max 2 levels deep.
- ALL tests live in a dedicated test directory/file. Not inline with source.
- Benchmarks in a dedicated benchmarks directory.

### Test Placement Rules (ABSOLUTE — NO EXCEPTIONS)
- **ZERO inline test modules in source files**. Period.
- All unit tests go in dedicated test files
- All integration tests go in dedicated integration test files
- All benchmarks go in dedicated benchmark files
- If a test needs private access, expose the item with restricted visibility — never make something fully public just for testing
- Every test function name describes the scenario: `test_{function}_{scenario}_{expected_result}`

### Source File Rules
- **One concept per file.** A file called `parser` contains the parser. Not the parser, the tokenizer, and three helper structs.
- **Prefer focused files.** Split when a file covers multiple unrelated concepts, not based on arbitrary line counts.
- **Prefer focused functions.** Extract helpers when a function does multiple distinct things, not based on arbitrary line counts.
- **No god modules.** If the entry point has more than re-exports and module declarations, it's wrong.
- **Imports grouped and ordered:**
  1. Standard library imports
  2. External dependency imports
  3. Workspace/internal package imports
  4. Local module imports
  5. Blank line between groups
- **No barrel exports** — don't re-export everything from submodules. Export what's public API.

### Naming Rules
- Files: `snake_case` — named for the concept, not the implementation
- Types: `PascalCase` — nouns, not verbs
- Functions: `snake_case` — verbs
- Constants: `SCREAMING_SNAKE_CASE` with doc comment explaining the value
- Traits/Interfaces: adjectives or `-able` suffix
- Test functions: `test_{unit}_{scenario}_{expectation}`
- Bench functions: `bench_{operation}_{input_size}`

### Module Dependency Rules
- No circular dependencies between modules
- Minimize public surface — if it doesn't need to be public, it isn't
- Prefer passing data over passing references to large structs
- Interface segregation: don't make a module depend on a type it doesn't use

---

## Documentation Rules

Documentation is not optional. Documentation is not "nice to have." Documentation is code. If it's not documented, it doesn't exist.

### Every Public Item
- Brief one-line description
- Longer explanation if the behavior is non-obvious
- Reference to relevant spec section if applicable
- Arguments: what each parameter represents and valid ranges
- Returns: what the return value means, when it returns error/none
- Panics/Crashes: document any conditions that can crash (should be none from external input)
- Performance: algorithmic complexity, allocation behavior
- Spec Reference: link to relevant spec section

### Every Module (top of file)
- What this module is responsible for
- What it is NOT responsible for (boundaries)
- Key types and their relationships

### Every Package (entry point)
- One paragraph: what this package does
- Key public types
- Dependency rationale (why this package exists as separate from others)
- Feature flags this package defines

### Architecture Documentation
- `docs/ARCHITECTURE.md` — updated when structure changes
- Decision records: every significant "why X over Y" documented in code or docs
- Performance baselines: documented benchmark numbers for critical paths

### Comment Quality
- Comments explain WHY, not WHAT. The code says what. Comments say why.
- Every TODO has an issue number
- Every HACK has a justification
- Every SAFETY comment explains the invariant

---

## Honesty Rules (for AI agents and humans alike)

These rules exist because LLMs are trained to satisfy users. Satisfaction is not the goal. Correctness is.

### Never Lie About Quality
- If code is bad, say it's bad. Don't soften "this will cause data corruption" into "this could potentially be improved."
- If a design is wrong, say it's wrong. Don't say "interesting approach" when you mean "this won't work."
- If you don't understand something, say so. Don't generate plausible-sounding explanations for code you haven't read.
- If a fix might break something else, say so BEFORE applying it. Not after.

### Never Lie About Completeness
- "Done" means ALL requirements met, ALL tests passing, ALL edge cases handled, linter clean, docs written. Not "the happy path works."
- Don't mark a task complete if you skipped parts of it.
- Don't say "tests pass" if you didn't run them.
- Don't say "linter clean" if you didn't check.
- If you got 8 out of 10 things done, say "8 out of 10 done, remaining: X, Y."

### Never Lie About Understanding
- If a user's idea is wrong, say so respectfully but clearly. Don't implement a bad idea just because they asked confidently.
- If a spec is ambiguous, flag it. Don't guess and pretend you know.
- If two requirements contradict, stop and ask. Don't silently pick one.

### Never Lie About Performance
- Don't say "optimized" without benchmarks.
- Don't say "fast" without numbers.
- Don't say "zero-cost" without proof.
- Don't say "cache-friendly" without measuring cache behavior.
- Claims require evidence. Period.

### The Anti-Vibe-Coding Manifesto
We do not "vibe code." We do not "just ship it." We do not generate code and hope it works. Every line has a reason. Every function has a test. Every design has a rationale. Every optimization has a benchmark.

The alternative is: "Vibe coded for 6 months. Codebase is a disaster. The app works. Revenue is coming in. Tried to onboard a dev. He opened the repo and went quiet for 2 minutes. Then said 'what is this.'"

That will NEVER be this project.

---

## Code Quality Standards

### Safety
| Rule | Enforcement |
|------|-------------|
| Forbid unsafe | Per-module/package safety enforcement |
| Bounded loops | Named `MAX_*` constants, documented rationale |
| Checked arithmetic | Saturating/checked operations — no wrapping on external data |
| Fallible allocation | Try-variants, capped containers |
| Must-use annotations | On all error types, all bool return values, all important results |
| No unwrap on external | Unwrap only on invariants with proof comment |

### Performance
| Rule | Enforcement |
|------|-------------|
| Zero unnecessary allocations | Profile before accepting heap allocation |
| Prefer stack | Small-size-optimized containers, inline storage for small N |
| Batch operations | Coalescing, batching where applicable |
| Cache-friendly | Arena allocation, contiguous storage, SoA where beneficial |
| Lazy evaluation | Don't compute until needed — dirty flags, incremental updates |
| No redundant work | Memoize expensive computations, cache results |
| Measure everything | No "should be faster" — benchmark it or it didn't happen |

### Correctness
| Rule | Enforcement |
|------|-------------|
| Spec compliance | Link to spec section in doc comments |
| Property testing | Property-based testing for all parsers and algorithms |
| Fuzz testing | Fuzz targets on all entry points accepting external input |
| Integration tests | Standard test suites for compliance |
| Regression tests | Every bug fix gets a test that would have caught it |

### Documentation
| Rule | Enforcement |
|------|-------------|
| All public items documented | Warn on missing docs in every module |
| Spec references | Link to relevant spec section for non-obvious behavior |
| Architecture docs | Updated when structure changes |
| Doc tests | Compile-checked examples in doc comments |
| Decision records | Why we chose X over Y — in code comments or ADR docs |

### Linting
Workspace-level strict linting. All lint violations are errors, not warnings. Configure the strictest pedantic and nursery-level lints available for your language/toolchain.

---

## Feature Flag Rules

### Compile-Time
- Every major subsystem is a feature flag
- Default includes what a normal user needs
- Features are additive only — no feature disables another feature
- Feature combinations are tested in CI
- Binary without any optional features must still compile and show a useful error

### Runtime
- Global feature registry — checked at decision points, not on every call (minimize overhead)
- Logged when toggled
- CLI flags: `--enable feature_name`, `--disable feature_name`
- Config file support

### Per-Profile
- JSON/TOML config per user profile
- Overrides runtime flags
- Stored in user config directory

---

## Dependency Rules

### External Dependency Selection
Before adding ANY dependency:
1. **Audit**: Read the source. Check for unsafe/security issues. Check CVE history.
2. **Alternatives**: Compare at least 2 options. Justify the choice.
3. **Size**: Prefer smaller packages. No kitchen-sink frameworks.
4. **Maintenance**: Check last commit, open issues, bus factor.
5. **License**: MIT, Apache-2.0, BSD, MPL-2.0 only. No GPL in library code.
6. **Features**: Use feature flags to minimize what we pull in.

### Dependency Graph
- Minimize depth between any two packages in our workspace
- No circular dependencies
- Minimize cross-package APIs — prefer passing data over passing control
- Interface packages for subsystem boundaries (trait/interface package + impl package)

---

## Git Rules

### Commits
- Atomic: one logical change per commit
- Format: `type(scope): description`
- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `perf`, `chore`, `security`
- All commits must pass: full test suite + linter with zero warnings

### Branches
- `master`/`main` — always buildable, always passing
- Feature branches per roadmap phase
- `fix/description` — bug fixes
- No force-push to master/main. Ever.

### Parallel Agent Work (MANDATORY)
When multiple AI agents work on the same repo simultaneously:
- **NEVER** have multiple agents commit to the same branch without worktrees
- **Each agent MUST create a git worktree** for its work
- **Single agent = can work directly on main branch.** No worktree needed.
- **Multiple agents = each gets a worktree.** Non-negotiable.
- Worktrees prevent HEAD conflicts, deadlocks, and half-committed states
- After work is done in worktree: commit, switch back to main repo, merge/cherry-pick, delete worktree
- If worktrees are not possible (tool limitation), **launch ONE agent at a time, sequentially**
- NEVER have 2+ agents running `git add`/`git commit` on the same working directory

### Reviews
- Every phase gets a dedicated review before merge
- Security-sensitive code gets 2 reviews
- FFI/binding code gets audit review

### Issue Hygiene — Zero Open Issues Policy
- **No phase begins with open issues from a prior phase.** Every issue must be closed — critical, major, AND minor — before moving forward.
- "Minor" does not mean "ignorable." Minor issues compound into major technical debt. Fix them.
- If an issue genuinely cannot be fixed now (blocked on future phase work), it gets a label `deferred:phase-NN` with a comment explaining WHY it's deferred and WHEN it will be addressed.
- If an audit finds issues, ALL findings become issues, and ALL are closed before the next phase starts.

---

## Testing Pyramid

```
                 ┌───────────┐
                 │   E2E     │  End-to-end / compliance tests
                ┌┤Integration├┐
               ┌┤│  Unit     ││  Per-function tests (in test dirs)
              ┌┤││  Fuzz     │││ Random input testing
             ┌┤│││  Property ││││ Property-based testing
             └┤│││  Bench    ││││ Performance regression
              └┤││           │││
               └┤│           ││
                └┤           │
                 └───────────┘
```

Every module/package must have:
- Unit tests for every public function — in dedicated test directory
- Property tests for every parser — in dedicated test directory
- Fuzz targets for every entry point accepting external input
- Benchmarks for every performance-critical function — in dedicated bench directory
- Integration tests for cross-module interactions — in dedicated test directory
- **ZERO inline test modules in source files.** All tests extracted to test directory.

---

## SSS Verification Doctrine

This section defines HOW to verify code is SSS grade, HOW to fix issues to SSS, and HOW to prevent regressions.

### What SSS Means

SSS means:

1. **Full Spec Compliance** — Every algorithm matches the spec step-by-step. Not "inspired by" the spec. Not "approximates" the spec. MATCHES it.

2. **Zero Stubs** — A stub is code that exists to prevent errors but doesn't do anything. Stubs are LIES. They make feature detection pass while the feature doesn't work. **Every function either works correctly or doesn't exist.**

3. **Zero Simplifications** — "Simplified implementation" is not SSS. It's a prototype. SSS means the FULL algorithm.

4. **Edge Cases Are Not Optional** — Every edge case in the spec is a requirement, not a nice-to-have.

5. **Tests Prove Compliance** — Standard test suites exist to verify compliance. If we don't run them, we cannot claim compliance. "Our own tests pass" is necessary but not sufficient.

### How to Fix an Issue to SSS Grade

Follow this exact process for every issue:

#### Step 1: Read the Spec
- Find the EXACT section that defines the behavior
- Read it completely. Not skim. READ.
- Note every step, every condition, every edge case

#### Step 2: Audit Current Code Against Spec
- Walk through the spec algorithm step by step
- For EACH step, verify the code implements it
- Document every gap: missing step, wrong condition, missing error, wrong output

#### Step 3: Implement the Full Algorithm
- Implement EVERY step from the spec
- Use the spec's terminology in variable names and comments
- Add spec section references as comments
- Handle EVERY branch the spec describes

#### Step 4: Handle ALL Edge Cases
- NULL/None/empty input
- EOF/end-of-stream
- Overflow (integer max, float infinity, NaN)
- Negative values where only positive expected
- Zero-length, zero-size
- Unicode edge cases (surrogates, BOM, combining characters)
- Boundary conditions (first, last, only, none, maximum)
- Circular references (cycle prevention)
- Maximum nesting depth
- Empty collections
- Concurrent/reentrant access (if applicable)

#### Step 5: Write Tests That Prove Correctness
- One test per spec requirement (not per function — per REQUIREMENT)
- Tests assert EXACT output, not just "didn't crash"
- Tests cover the happy path AND every edge case
- Property tests for "never crashes on arbitrary input"
- Fuzz targets for "never produces invalid output on arbitrary input"

#### Step 6: Verify Against Reference Implementation
- Run standard compliance test suites
- Compare output against known-good implementations
- Any difference is a bug until proven otherwise

### How to Verify Code is SSS

ALL items must be YES. Any NO means it's not SSS.

```
[ ] Every spec algorithm step has a corresponding code path
[ ] Every spec algorithm step has a comment citing the spec section
[ ] Every error condition defined by the spec is handled
[ ] Every edge case is handled
[ ] No stubs — every function does what it claims
[ ] No simplifications — full algorithm, not subset
[ ] No hardcoded values — all constants named and documented
[ ] Tests exist for every requirement
[ ] Tests assert exact output, not just "no crash"
[ ] Standard compliance test suite passes (where applicable)
[ ] Property tests prove "never crashes"
[ ] Fuzz targets prove "never produces invalid output"
[ ] Code compiles/runs with zero warnings
[ ] Linter passes with strict lints
[ ] All public items have doc comments with spec references
```

### How to Detect Non-SSS Code (Red Flags)

If you see ANY of these, the code is NOT SSS:

- `// TODO` without an issue number
- `// simplified` or `// subset` or `// for now`
- A branch/match arm that returns a default/empty value for cases it should handle
- A function that always returns null/None/0/false/empty
- A comment saying "the spec requires X but we do Y"
- Missing states in a state machine (fewer states than the spec defines)
- A loop with a hardcoded limit that doesn't match the spec's limit
- An algorithm that searches N elements when the spec says search ALL
- A data table with fewer entries than the spec defines
- Tests that only test the happy path
- No standard compliance test integration

### Marking Issues as RESOLVED

An issue may ONLY be marked RESOLVED when ALL of the following are true:

1. The code implements the FULL spec algorithm (not a subset)
2. ALL edge cases are handled (not just common cases)
3. Tests exist that PROVE correctness (not just "it compiles")
4. Standard compliance tests pass for the relevant test cases
5. No stubs remain in the code path
6. The code has been audited against the spec step-by-step

**Marking an issue RESOLVED because "the file exists" or "the function is defined" is FRAUD.** The function must WORK CORRECTLY for ALL inputs defined by the spec.

---

## Anti-Patterns That WILL Be Rejected

### The "File Exists" Fallacy
Creating a file with the right name and a skeleton implementation is NOT solving an issue. The implementation must be COMPLETE and CORRECT.

### The "It Compiles" Fallacy
Code that compiles but produces wrong output is worse than code that doesn't compile. At least compilation errors are visible. Wrong output is a silent bug.

### The "Tests Pass" Fallacy
Tests that don't assert correct behavior always pass. A test that calls a function without checking the result proves nothing. Tests must assert EXACT expected output.

### The "Struck Through" Fallacy
Marking an issue as resolved in a markdown file does not make the code correct. The code must be audited against the spec. If the audit finds gaps, the issue is NOT resolved regardless of what the markdown says.

### The "Partial Implementation" Excuse
"Partial" is not a grade. It's a failure state. Either the feature works completely per spec, or it doesn't work. There is no middle ground. Users don't get "partial" functionality.

---

## IRONCLAD: Issue Striking Rules

**These rules are NON-NEGOTIABLE. Violation = immediate revert of ALL strikes in the session.**

**HISTORY: On 2026-05-10, 642 issues were falsely struck as SSS-VERIFIED by agents who wrote code and assumed it was correct. This was the worst quality failure in the project's history. These rules exist to make that IMPOSSIBLE to repeat.**

---

### Rule 1: NEVER Strike an Issue Until It Is PROVEN SSS Grade

- An issue header stays **UN-STRUCK** until the implementation is **verified** SSS through the full audit protocol
- "RESOLVED" means SSS. Not "code exists". Not "compiles". Not "tests pass". **SSS with proof.**
- If you cannot produce EVIDENCE of SSS compliance, **DO NOT STRIKE IT**
- "I'm pretty sure it's correct" is NOT evidence. Run the audit. Show the results.

---

### Rule 2: Every Issue Gets a Current Grade Assessment

When working on issues, each issue header must show its current state:
- Current grade (what it is NOW after honest audit)
- What's missing for SSS (specific gaps, not vague descriptions)
- Only when ALL gaps are filled AND audited does it get struck through

**Grade assessment format (add below the issue header when working on it):**
```markdown
**Current Grade: [letter grade]**
**Missing for SSS:**
- [specific gap — which test is missing, which edge case is unhandled]
- [specific gap — what spec requirement has no corresponding code]
- [specific gap — what integration is not wired]
```

---

### Rule 3: Striking Format — EXACT Syntax

An issue has three possible states in the issues file:

#### State 1: UN-STRUCK (not done / not yet SSS)
The issue header is plain text. No `~~`, no `[SSS-VERIFIED]`.

#### State 2: UN-STRUCK with grade assessment (work in progress)
When an agent has worked on an issue but it is NOT yet SSS, add a grade block BELOW the header. The header itself remains plain (no `~~`).

#### State 3: STRUCK (SSS verified with full audit)
The header gets `~~` around the title text and `[SSS-VERIFIED]` appended. An audit block is added below documenting the proof.

```markdown
### ~~PREFIX-NNNNN: issue title here~~ [SSS-VERIFIED]

**Audit: [YYYY-MM-DD]**
- Implementation: `[file path]:[line range]`
- Tests: `[test file path]` ([N] tests, all pass)
- Edge cases: [list of edge cases verified]
- Spec reference: [spec name and section number]
- Comparison: [what reference implementation behavior matches]
- Regression: full test suite — [N] pass, 0 fail
```

| Element | Syntax | Notes |
|---------|--------|-------|
| Strike markers | `~~` | Placed around title text ONLY, not the `###` or `[SSS-VERIFIED]` |
| Verification tag | `[SSS-VERIFIED]` | MUST appear after closing `~~`, separated by a space |
| Audit block | Starts with `**Audit: YYYY-MM-DD**` | MUST be present on every struck issue |
| Grade block | `**Current Grade: X**` | Only on unstruck issues being worked on |

---

### Rule 4: The Striking Ceremony — Step by Step

**You MUST follow this EXACT sequence to strike an issue. Skipping ANY step invalidates the strike.**

```
STEP 1: FINISH IMPLEMENTATION
├── All code written
├── All tests written
├── Code compiles/runs with zero errors and zero warnings
└── All tests pass

STEP 2: PERFORM THE 6-STEP AUDIT
├── Step 1: Code Completeness Audit — PASS/FAIL
├── Step 2: Edge Case Audit — PASS/FAIL
├── Step 3: Test Coverage Audit — PASS/FAIL
├── Step 4: Integration Audit — PASS/FAIL
├── Step 5: Comparison Audit — PASS/FAIL
└── Step 6: Regression Audit — PASS/FAIL

STEP 3: DOCUMENT THE AUDIT RESULT
├── Write the audit note (date, files, tests, edge cases, comparison)
├── If ANY step is FAIL → DO NOT PROCEED. Fix the failure first.
└── Only if ALL 6 steps are PASS → proceed to Step 4

STEP 4: STRIKE THE ISSUE
├── Add ~~ around the issue title text
├── Append [SSS-VERIFIED] after the closing ~~
├── Add the audit note block below the struck header
└── Commit with message: "audit(scope): strike ISSUE-NNNNN as SSS-VERIFIED"

STEP 5: VERIFY THE STRIKE
├── Re-read the struck issue — does the audit note have ALL required fields?
├── Re-run tests one final time — still passing?
└── If anything is wrong → UNSTRIKE immediately
```

---

### Rule 5: Unstrike Protocol — When Audit Finds Gaps

If a subsequent audit (by any agent, at any time) finds ANY gap in a struck issue:

1. **Immediately unstrike it** — remove `~~` and `[SSS-VERIFIED]`
2. **Document the gap found** — add a note: `**UNSTRUCK [date]: [reason]**`
3. **Fix the gap** — implement the missing piece
4. **Re-run the FULL 6-step audit** — not just the part that failed
5. **Only then re-strike** — with a NEW audit note showing the fix

---

### Rule 6: What Constitutes SSS for an Issue — The Complete Checklist

**ALL of these must be TRUE simultaneously. A single FALSE means NOT SSS.**

#### Implementation Completeness
- [ ] Full spec algorithm implemented (not subset, not simplified, not "close enough")
- [ ] Every step of the spec algorithm has corresponding code with a spec citation comment
- [ ] No stubs in the code path (functions that return default/empty/null for cases they should handle)
- [ ] No TODO/FIXME/HACK comments in the code path
- [ ] No `// simplified` or `// for now` or `// subset` comments
- [ ] Code compiles/runs with zero errors AND zero warnings
- [ ] Linter clean with strict lints

#### Edge Case Handling
- [ ] ALL edge cases from the spec are handled (NULL, EOF, empty, overflow, boundary, negative, zero)
- [ ] Malformed/adversarial input does not crash or produce undefined behavior
- [ ] Boundary conditions tested (first, last, only, none, maximum)
- [ ] Type boundaries respected (no integer overflow, no float precision loss where it matters)

#### Test Coverage
- [ ] Tests assert EXACT output (not just "didn't crash" or "returned something")
- [ ] One test per spec requirement minimum
- [ ] Edge case tests for every edge case identified in the spec
- [ ] Property tests: "never crashes on arbitrary input" (where applicable)
- [ ] Standard compliance test cases pass for this feature (where applicable)
- [ ] Tests are in separate files in test directory (NOT inline in source)

#### Integration
- [ ] Code is actually CALLED from the runtime pipeline (not dead code)
- [ ] Adjacent systems interact correctly with this code
- [ ] End-to-end path from input to output works

#### Verification
- [ ] Behavior matches reference implementations for the specific feature
- [ ] No existing tests broke (regression check)
- [ ] Full module test suite passes

---

### Rule 7: Batch Striking is ABSOLUTELY FORBIDDEN

- Each issue is **individually** verified before striking
- You CANNOT strike 50 issues at once because "the module exists"
- You CANNOT strike issues because "they're all similar and one works"
- You CANNOT strike issues because "the tests pass" without auditing each one
- Each strike requires **individual evidence** specific to THAT issue
- If you strike N issues, you must have performed N complete audits

**The 642 false positives happened because agents batch-struck issues. NEVER AGAIN.**

---

### Rule 8: The "Confidence Trap" — Why You MUST Audit Even When Sure

**The most dangerous moment is when you feel confident the code is correct.**

When you feel confident without auditing:
- You are experiencing the Dunning-Kruger effect applied to code
- You are about to make the same mistake that caused 642 false positives
- You are about to waste the next agent's time unstriking your work

**The audit takes 5 minutes. A false positive wastes hours.**

ALWAYS audit. Even when you're "sure." ESPECIALLY when you're "sure."

---

### Rule 9: What to Do When You Cannot Complete an Audit

If you cannot fully audit an issue (rate limited, session ending, missing information):

1. **DO NOT STRIKE IT** — leave it unstruck
2. **Document what you verified** — partial audit notes are valuable
3. **Document what remains** — so the next agent knows what to check
4. **Commit your code** — the implementation is still valuable even unstruck
5. **The next agent will complete the audit** — that's fine, that's the process

**An unstruck issue with good code is infinitely better than a falsely struck issue.**

---

### Rule 10: The Nuclear Option — Mass Unstrike

If at ANY point an audit reveals that multiple struck issues are NOT actually SSS:

1. **ALL strikes from that session/agent are suspect**
2. **Unstrike ALL issues struck in that session** — guilty until proven innocent
3. **Document the failure** — what went wrong, why the agent falsely struck
4. **Add preventive rules** — update this RULES.md to prevent recurrence
5. **Re-audit from scratch** — each issue individually

**This happened on 2026-05-10. 642 issues were mass-unstruck. It must never happen again.**

---

## Autonomous Agent Operational Protocol

**This section is written for ANY AI agent working on this codebase autonomously. It does NOT assume any specific tooling, MCP servers, or IDE integration. Follow this EXACTLY regardless of your environment.**

### Before You Touch ANY Code

1. **Read this entire RULES.md file.** Not skim. READ. Every rule applies to you.
2. **Read the issue file you're working on.** Understand what each issue requires.
3. **Read the relevant source code.** Do NOT assume you know what the code does. READ IT.
4. **Read the relevant spec.** You MUST know what correct behavior looks like before you can implement it. If you cannot access the spec online, use your training knowledge BUT explicitly note "from training, not verified against live spec."
5. **Plan your work.** Use whatever task-tracking is available. Break large tasks into small, verifiable steps.

### The Fix Protocol (How to Make Code SSS)

For EVERY issue you work on, follow this EXACT sequence:

```
STEP 1: UNDERSTAND
├── Read the issue description
├── Read the relevant spec section (cite it)
├── Read the current source code
├── Identify EVERY gap between spec and code
└── Document gaps before writing any code

STEP 2: IMPLEMENT
├── Implement the FULL spec algorithm (not a subset)
├── Use spec terminology in variable names
├── Add spec section comments on every non-obvious line
├── Handle ALL edge cases (NULL, EOF, empty, overflow, boundary)
└── NO stubs, NO simplifications, NO "for now" code

STEP 3: TEST
├── Write tests that assert EXACT output (not just "no crash")
├── One test per spec requirement
├── Edge case tests for every edge case from Step 1
├── Property tests: "never crashes on arbitrary input"
├── Run ALL existing tests to verify no regressions
└── Run standard compliance tests if applicable

STEP 4: VERIFY
├── Code compiles/runs with ZERO errors
├── ALL tests pass with ZERO failures
├── No new warnings introduced
├── Read the code one more time — does it match the spec?
├── Would this code pass if someone compared it line-by-line to the spec?
└── Is there ANY case where this code produces wrong output?

STEP 5: COMMIT
├── Commit with descriptive message
├── Strike the issue ONLY if ALL of Step 4 is YES
└── If ANY doubt remains, DO NOT STRIKE — document what's uncertain
```

### The Audit Protocol (How to Verify SSS)

When auditing code that claims to be SSS, follow this EXACT process:

```
AUDIT STEP 1: READ THE SPEC
├── Open the relevant spec section
├── List every algorithm step
├── List every edge case mentioned
├── List every error condition defined
└── List every special case / exception

AUDIT STEP 2: TRACE THE CODE
├── For EACH spec step, find the corresponding code
├── If a spec step has NO corresponding code → NOT SSS
├── If a spec step has WRONG corresponding code → NOT SSS
├── If an edge case is not handled → NOT SSS
├── If an error condition is not handled → NOT SSS
└── If a function returns null/empty/default for cases it should handle → NOT SSS (it's a STUB)

AUDIT STEP 3: RUN TESTS
├── Run ALL tests in the relevant module
├── If any test fails → NOT SSS
├── Check test coverage — are edge cases tested?
├── If edge cases are NOT tested → NOT SSS (even if code looks correct)
├── Run compliance tests if applicable
└── If compliance tests fail → NOT SSS

AUDIT STEP 4: GRADE
├── ALL spec steps implemented + ALL edge cases handled + ALL tests pass = SSS
├── MOST spec steps + MOST edge cases + tests pass = A (not acceptable)
├── SOME spec steps + SOME edge cases = B-C (major rewrite needed)
├── Stubs / empty functions / wrong output = D-F (discard and redo)
└── Document the grade and what's missing
```

### The Detection Protocol (How to Find Non-SSS Code)

**Red flags that IMMEDIATELY indicate non-SSS code:**

| Red Flag | What It Means | Action |
|----------|---------------|--------|
| Return null/empty/0 in a function that should compute something | STUB — function doesn't work | Implement the real algorithm |
| `// TODO` / `// FIXME` / `// HACK` / `// simplified` / `// for now` | Known incomplete | Fix it |
| Catch-all/wildcard that should handle specific cases | Missing cases | Add all cases |
| A state machine with fewer states than the spec defines | Incomplete implementation | Add missing states |
| A data table with fewer entries than the spec defines | Incomplete data | Complete the table |
| A loop that searches N elements when spec says "all" | Incorrect algorithm | Fix the limit |
| A function that always returns the same value regardless of input | STUB | Implement real logic |
| Tests that call functions without asserting output | Useless tests | Add assertions |
| Unwrap/crash on external data | Crash waiting to happen | Use proper error handling |
| No spec reference in comments | Unverified correctness | Add spec citations |

### Commit Protocol

**When to commit:**
- After fixing ONE issue or a SMALL BATCH of closely related issues
- After ALL tests pass
- After verifying the code compiles/runs with zero errors
- NEVER commit broken code. NEVER commit code that doesn't compile. NEVER commit code with failing tests.

**Commit message format:**
```
type(scope): brief description

- What was done (bullet points)
- Spec reference if applicable
- Test results: "X tests pass, 0 failures"
```

**Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `perf`

**Push immediately after commit.** Do not accumulate commits. Rate limits and session interruptions can lose unpushed work.

### What "Don't Stop" Means

When the user says "don't stop until all issues are SSS":
1. Work through issues ONE BY ONE (or in small related batches)
2. For each issue: understand → implement → test → verify → commit → strike
3. If you hit a rate limit or session end, your work is safe because you pushed after each commit
4. The NEXT session picks up where you left off — check the issues file to see what's struck and what isn't
5. Continue until EVERY issue in the file is struck as SSS-VERIFIED
6. Do NOT conclude the session with a "summary of what remains" — just keep working

### What "SSS" Means in Plain Language

**SSS = The code is so correct, so complete, so robust that:**
- No edge case can break it
- No malformed input can crash it
- No spec requirement is missing
- No test can be written that would fail
- No auditor can find a gap between the spec and the code
- No future developer would need to "fix" it — only extend it
- It handles everything the spec defines, perfectly, every time

**SSS is NOT:**
- "It works for the common cases" (that's B grade)
- "It compiles and tests pass" (that's A grade)
- "It's close to the spec" (that's A+ grade)
- "It handles most edge cases" (that's S grade)

**SSS IS:**
- "It matches the spec step-for-step, handles every edge case, has tests proving every requirement, and produces correct output for every possible input defined by the spec."

### Tool Usage (General — Any Agent, Any Environment)

**Principles for ANY tool environment:**

1. **Read before write.** ALWAYS read the file/function/module before modifying it. Never edit blind.
2. **Search smart.** If a code graph, symbol index, or semantic search is available — use it FIRST. Fall back to grep/find only when structured tools don't cover what you need.
3. **Minimize context waste.** Don't read entire 3000-line files when you need 50 lines. Be surgical.
4. **Parallelize independent work.** If you need to read 5 files that don't depend on each other, read them all at once.
5. **Track your work.** Use whatever task-tracking mechanism is available.
6. **Commit early, commit often.** After fixing an issue or small batch, commit and push IMMEDIATELY. Sessions can be interrupted. Unpushed work is lost work.
7. **Verify before claiming.** Run the build. Run the tests. Check the output. NEVER say "done" without evidence.

**Do NOT:**
- Edit code you haven't read first
- Assume you know what a function does without reading it
- Skip compilation checks after changes
- Skip test runs after changes
- Accumulate many changes without committing
- Write summaries instead of doing work
- Stop working when there are still issues to fix

### Session Continuity (For Any Agent Across Sessions)

**At the START of every session:**
1. Read the issues file to see current state (what's struck, what isn't)
2. Read RULES.md (this file) to refresh the protocol
3. Check `git log --oneline -10` to see recent work
4. Pick up where the last session left off
5. If any persistent memory/notes system is available, check it for context from previous sessions

**At the END of every session (or if interrupted):**
1. Commit and push ALL completed work — this is NON-NEGOTIABLE
2. Update the issues file with current grades for any issues you worked on
3. If persistent memory is available, store your progress and next steps
4. Do NOT write a "summary" message — just keep working until interrupted
5. The NEXT agent will read the issues file and git log to understand state

**If you are a NEW agent picking up this project:**
- You are NOT starting fresh. Previous agents have done work. Check git log.
- Read the issues file FIRST to see what's done and what isn't.
- Read this RULES.md COMPLETELY before touching code.
- Your job is to continue making issues SSS, not to redo work that's already done.
- If previous work is wrong (fails audit), unstrike it, fix it, re-verify, re-strike.

---

## The Passion — Why This Exists

This is not a hobby project. This is not a learning exercise. This is not "let's see how far we get."

**We are building the best possible software.** Period. Full stop. No qualifiers.

This project is different because:
- **We start from zero.** No legacy. No inherited bugs. No "we can't change this because it would break backward compatibility."
- **We write everything ourselves.** From input to output, A to Z. Every connection between subsystems is intentional, designed, and perfect.
- **We never say "good enough."** We say "perfect" or "not done yet." There is no middle ground.
- **We never simplify the spec.** If the spec defines it, we implement it. All of it.
- **We never ship stubs.** A function either works correctly or it doesn't exist. There is no "returns null for now."

**The standard is SSS.** Not because it sounds cool. Because SSS means: "This code handles every case the spec defines, correctly, every time, with proof."

**This passion is not negotiable.** Every agent, every developer, every contributor who touches this codebase accepts this standard or doesn't contribute. The code is either perfect or it's not done yet. We don't ship imperfect code. We don't mark issues as resolved when they're not. We don't lie to ourselves about quality.

**That's the bar. That's the passion. That's why we're here.**

---

## MANDATORY POST-IMPLEMENTATION AUDIT PROTOCOL (Added 2026-05-10)

**CONTEXT: On 2026-05-10, we discovered that 642 issues were falsely marked as SSS-VERIFIED. Agents wrote code, assumed it was correct, and struck issues without auditing. This is UNACCEPTABLE. This section exists to prevent this from EVER happening again.**

### THE CARDINAL RULE

**NEVER mark an issue as SSS-VERIFIED based on the act of writing code alone.**

Writing code is NOT verification. Writing tests is NOT verification. Passing tests is NOT verification. Only a FULL AUDIT against the SSS criteria constitutes verification.

**The sequence is ALWAYS: Write → Audit → Strike (if passes) or Fix (if fails)**
**NEVER: Write → Strike → Hope it's correct**

### MANDATORY AUDIT STEPS (ALL REQUIRED, NO EXCEPTIONS)

After writing code for ANY issue, the implementing agent MUST perform ALL of the following before striking:

#### Step 1: Code Completeness Audit
- [ ] Read the issue's "Required fix" field word by word
- [ ] For EACH requirement in that field, identify the EXACT lines of code that implement it
- [ ] If ANY requirement cannot be mapped to specific code lines → NOT SSS, DO NOT STRIKE
- [ ] Verify no stubs exist (functions returning default values for cases they should compute)
- [ ] Verify no TODO/FIXME/HACK in the code path

#### Step 2: Edge Case Audit
- [ ] Read the relevant spec section
- [ ] Identify ALL edge cases mentioned in the spec
- [ ] Verify EACH edge case is handled in code with a specific test
- [ ] If ANY edge case is missing → NOT SSS, DO NOT STRIKE

**Common edge cases that MUST be checked:**
- NULL/None/empty input
- Zero-length, zero-size
- Negative values where only positive expected
- Overflow (integer max, float infinity, NaN)
- Unicode edge cases (surrogates, BOM, RTL, combining characters)
- Concurrent/reentrant access (if applicable)
- Circular references
- Maximum nesting depth
- Empty collections

#### Step 3: Test Coverage Audit
- [ ] Run the tests and confirm they PASS
- [ ] Verify tests cover: happy path, error path, boundary conditions, null/empty inputs, concurrent access (if applicable)
- [ ] Verify tests are NOT trivial (testing that true == true is not a test)
- [ ] Verify tests assert EXACT values (not just "is not None" or "length > 0")
- [ ] If test coverage is incomplete → NOT SSS, DO NOT STRIKE

#### Step 4: Integration Audit
- [ ] Verify the code integrates with adjacent systems (not just standalone)
- [ ] Check that the code is actually CALLED from the runtime pipeline
- [ ] Dead code that exists but is never invoked is NOT a fix
- [ ] If code is not wired into the system → NOT SSS, DO NOT STRIKE

#### Step 5: Comparison Audit
- [ ] Compare behavior against reference implementations for the specific feature
- [ ] If behavior diverges from all reference implementations → NOT SSS, DO NOT STRIKE
- [ ] Document which reference implementation(s) the behavior matches
- [ ] If no reference available: document "comparison not possible, relying on spec compliance"

#### Step 6: Regression Audit
- [ ] Verify no existing tests broke
- [ ] Verify no adjacent features regressed
- [ ] Run full module test suite
- [ ] If anything regressed → NOT SSS, DO NOT STRIKE

---

### AUDIT RESULT DOCUMENTATION FORMAT

After completing the audit, document the result:

**If ALL 6 steps PASS:**
```markdown
**Audit: YYYY-MM-DD — PASS (SSS)**
- Code: `[file path]:[line range]`
- Tests: `[test file path]` ([N] tests pass)
- Edge cases: [list verified]
- Comparison: Matches [reference implementation(s)]
- Regression: full test suite — [N] pass, 0 fail
```

**If ANY step FAILS:**
```markdown
**Audit: YYYY-MM-DD — FAIL (Grade: [letter])**
- FAILED Step [N] ([name]): [specific reason]
- Action: [what needs to be fixed], re-audit
```

---

### WHAT HAPPENS IF YOU SKIP THE AUDIT

- The issue will be UNSTRUCK in the next session
- All your work will be treated as UNVERIFIED
- The next agent will have to redo the audit from scratch
- You will have WASTED tokens, time, and money
- Your strikes will be mass-reverted (as happened on 2026-05-10)

### NEVER DO THIS

- NEVER write code → immediately strike
- NEVER write tests → assume SSS because tests pass
- NEVER read the issue title → assume you know what's needed without reading the full issue
- NEVER pattern-match against similar issues → assume same fix works
- NEVER trust previous agent's work → always re-verify if in doubt
- NEVER strike multiple issues in batch without individual audits
- NEVER use heuristics or shortcuts to determine SSS status
- NEVER strike an issue you haven't personally audited in THIS session
- NEVER strike because "it looks right" — run the audit, get the evidence

### ALWAYS DO THIS

- ALWAYS write code → audit code → audit tests → audit integration → THEN strike
- ALWAYS read the FULL issue including all evidence fields
- ALWAYS test against real inputs, not just unit tests
- ALWAYS document your audit findings in the issue
- ALWAYS if uncertain about SSS status → DO NOT STRIKE, leave for next session
- ALWAYS treat every issue as if it will be audited by a hostile reviewer
- ALWAYS run the full test suite before striking — never assume tests still pass
- ALWAYS check that your code is reachable from the runtime (not dead code)

### ARROGANCE KILLS QUALITY

The reason 642 issues were falsely struck is ARROGANCE. The agents assumed their code was correct without checking. They assumed tests passing meant the feature worked. They assumed writing code meant the problem was solved.

**Assumption is the enemy of quality. Verification is the only path to SSS.**

Every time you feel confident that your code is correct without auditing it — that feeling is WRONG. Audit anyway. The audit will either confirm your confidence (good) or reveal a bug you missed (better than shipping it).

**Remember: 642 false positives. Never again.**

---
