# Visual Multi-Agent Playground — MVP Specification

## 1. Product definition

The application is a browser-based visual environment where users create AI agents, arrange them as nodes in a directed graph, configure their behavior, connect them, and run structured conversations among selected agents.

Each agent represents:

* a role
* a behavioral profile
* a system instruction
* a selected LLM provider and model
* a set of declared skills
* generation parameters
* optional conversation constraints

Connections between agents represent allowed communication paths or conversation order.

The MVP must demonstrate four core capabilities:

1. Users can create and manage agents.
2. Users can visually arrange and connect agents.
3. Users can define custom LLM providers.
4. Users can run and inspect a multi-agent conversation around a subject.

The MVP is not an autonomous agent platform. It is a controlled visual orchestration playground.

---

# 2. MVP goals

The MVP should validate these product assumptions:

* Users understand agents more easily when represented visually.
* Users can define useful agent behavior without writing application code.
* Directed graph connections are a practical way to control agent communication.
* Multiple agents can produce a coherent conversation under a simple orchestration model.
* A custom provider configuration can support multiple OpenAI-compatible LLM services without provider-specific application code.

A successful MVP allows a user to build a graph with three agents, connect them, provide a topic, run a conversation, inspect each response, stop execution, modify an agent, and run it again.

---

# 3. Non-goals

The following should remain outside the MVP:

* autonomous tool execution
* web browsing by agents
* file uploads and document retrieval
* vector databases or long-term memory
* server-side persistence
* user accounts
* team collaboration
* real-time multi-user editing
* plugin marketplaces
* arbitrary JavaScript execution
* workflow scheduling
* background execution
* branch-based agent workflows
* complex planning agents
* agent-to-agent message negotiation
* automatic provider discovery
* billing management
* production-grade secret storage
* guaranteed support for every LLM API format

These features would expand the system from a playground into an agent execution platform.

---

# 4. Technical positioning

## 4.1 Browser-only architecture

The complete MVP runs inside the browser.

The application consists of:

* React user interface
* graph visualization layer
* local state management
* browser persistence
* provider request adapter
* conversation orchestration engine
* execution log and transcript viewer

There is no application server.

The browser directly calls configured LLM provider APIs.

This creates three important constraints:

### API credentials are exposed to the browser

Any API key entered into the application is accessible to the browser session and potentially to browser extensions, injected scripts, or compromised dependencies.

The UI must clearly state:

> Provider credentials are stored and used in this browser. Do not use unrestricted production keys.

### Providers must support browser-origin requests

The provider endpoint must permit Cross-Origin Resource Sharing, or CORS, from the application origin.

A correct API key is not sufficient. The request will still fail when the provider blocks browser-origin requests.

### Some providers cannot safely support browser-only access

Providers designed exclusively for server-to-server access may be incompatible. This is not an application defect and must be reported as a provider compatibility error.

---

# 5. React Digraph usage

`react-digraph` is appropriate for the initial graph-editor surface because it provides a directed graph editor, node and edge rendering, selection, graph editing callbacks, zoom controls, custom node types, custom edge types, and node positioning. Its `GraphView` component expects the host application to own graph state and supply editing callbacks.

The library supports:

* creation of nodes and edges
* movement of nodes
* custom SVG node shapes
* node and edge selection
* multiple node and edge types
* multiselect behavior
* deletion and clipboard-style operations

The documented graph data model uses node coordinates and typed directed edges, which maps directly to a visual agent network.

The application must not store the complete agent definition directly inside the visualization library’s internal node representation.

Use two conceptual layers:

### Graph layer

Contains only graph-specific information:

* node ID
* node title
* node type
* x coordinate
* y coordinate
* edge source
* edge target
* edge type

### Domain layer

Contains agent configuration:

* role
* instructions
* provider
* model
* parameters
* skills
* status
* metadata

The graph node ID connects both layers.

This separation prevents the graph library from becoming the application’s domain model.

---

# 6. Primary user experience

## 6.1 Main workspace

The main screen contains five areas.

### Top toolbar

Contains:

* playground name
* new playground
* save status
* import
* export
* run
* pause or stop
* clear conversation
* settings

### Left sidebar: component palette

Contains:

* add agent
* agent templates
* provider manager
* saved playgrounds

For the MVP, agent templates should be limited to:

* blank agent
* analyst
* critic
* moderator
* researcher
* summarizer

Templates are initial values only. They do not require special runtime behavior.

### Center: visual graph canvas

Contains:

* agent nodes
* directed connections
* zoom controls
* selection behavior
* drag positioning
* add-edge interaction
* delete interaction
* execution highlighting

### Right inspector

Displays the selected agent or connection.

For an agent, it shows its complete editable configuration.

For a connection, it shows connection settings.

### Bottom execution panel

Contains:

* conversation transcript
* event log
* current execution status
* provider errors
* token and latency estimates when available

The panel should be collapsible.

---

# 7. Core domain objects

## 7.1 Playground

A playground is the complete saved user workspace.

Required fields:

* unique ID
* name
* description
* version
* creation timestamp
* update timestamp
* agents
* graph nodes
* graph edges
* providers
* conversation settings
* current transcript
* UI layout state

The persisted format must include a schema version so future releases can migrate old playground files.

---

## 7.2 Agent

Each agent requires the following fields.

### Identity

* unique ID
* name
* optional description
* visual type
* optional icon or initials

### Role

A short functional label.

Examples:

* Product strategist
* Skeptical reviewer
* Technical architect
* Moderator

### System instruction

The main instruction sent to the model.

This should be plain text and directly editable.

### Characteristics

Structured behavioral values:

* tone
* verbosity
* creativity
* assertiveness
* skepticism
* cooperation level

For the MVP, these values do not need a complex behavioral engine. They can be converted into a generated instruction fragment appended to the system prompt.

Example conceptual transformation:

> Communicate concisely. Challenge unsupported claims. Maintain a neutral tone. Prefer evidence over agreement.

### Skills

Skills in the MVP are declared capabilities, not executable tools.

Examples:

* analysis
* brainstorming
* summarization
* critique
* prioritization
* technical design
* risk analysis

A skill consists of:

* name
* short description
* optional instruction text
* enabled or disabled state

During execution, enabled skill instructions are merged into the agent’s system prompt.

The application must not imply that adding a “web search” skill gives the agent actual web access.

### LLM configuration

* provider ID
* model identifier
* temperature
* maximum output tokens
* optional top-p
* optional seed
* optional stop sequences

Provider-specific unsupported fields should be omitted rather than sent blindly.

### Runtime configuration

* enabled or disabled
* maximum responses per run
* optional response timeout
* include conversation history
* history window size
* optional opening instruction
* optional final-response instruction

### Visual state

* graph position
* node type
* display color category
* selected state
* runtime state

Runtime states:

* idle
* queued
* generating
* completed
* failed
* disabled

---

## 7.3 Connection

A connection is a directed relationship between two agents.

Required fields:

* unique ID
* source agent ID
* target agent ID
* enabled state
* connection type

MVP connection types:

### Conversation flow

The target may respond after the source.

### Review flow

The target is instructed to review the source agent’s most recent answer.

### Handoff flow

The target receives the source output as its primary task context.

These connection types may initially alter prompt construction only. They do not require separate execution engines.

Optional fields:

* label
* priority
* instruction override

Example edge instruction:

> Focus only on factual weaknesses in the previous response.

---

## 7.4 Provider

A provider represents an LLM API configuration.

Required fields:

* unique ID
* display name
* API base URL
* API path
* authentication method
* API key
* request format
* response format
* default model
* available model identifiers
* custom headers
* timeout
* enabled state

The MVP should support one canonical provider protocol:

> OpenAI-compatible chat-completions format

This avoids building a general API-mapping engine in the first version.

A custom provider should therefore be defined through:

* provider name
* base URL
* chat-completions path
* API key
* authentication header name
* authentication prefix
* model name
* optional extra headers

Example conceptual configuration:

* Base URL: provider API root
* Path: `/v1/chat/completions`
* Header: `Authorization`
* Prefix: `Bearer`
* Model: provider-defined model ID

The user should also be able to choose:

* no authentication
* bearer-token authentication
* custom header authentication

Do not support arbitrary request-body templates in the MVP. That feature introduces validation, security, and compatibility complexity.

---

# 8. Custom LLM provider management

## 8.1 Provider manager

Users must be able to:

* add a provider
* edit a provider
* delete a provider
* duplicate a provider
* test a provider
* set a default provider
* assign providers independently to agents

## 8.2 Provider test

The “Test connection” action should send a minimal request using:

* the selected model
* one small system message
* one small user message
* low maximum output tokens

The result should display:

* success or failure
* HTTP status
* request duration
* parsed model response
* sanitized error message

Secrets must never be shown in logs.

## 8.3 Provider compatibility errors

The application should distinguish:

* invalid URL
* CORS rejection
* network failure
* authentication failure
* model not found
* rate limit
* malformed response
* timeout
* unsupported response structure
* provider server error

This distinction is essential in a browser-only product because CORS errors are common and otherwise confusing.

## 8.4 Credential storage

The provider editor should offer two storage modes:

### Session only

The API key remains in memory or session storage and is removed when the session ends.

This should be the default.

### Remember in this browser

The API key is stored in local browser storage.

This option must display an explicit security warning.

The persisted playground export should exclude API keys by default.

An optional “include credentials” export should not be part of the MVP.

---

# 9. Agent creation and management

## 9.1 Create agent

A user can create an agent through:

* an “Add agent” button
* dragging a template onto the graph
* duplicating an existing agent

The creation form should require only:

* name
* role
* system instruction
* provider
* model

All other fields receive defaults.

## 9.2 Edit agent

Selecting a node opens its inspector.

Edits should update local state immediately.

Editable sections:

* identity
* role and instructions
* characteristics
* skills
* provider and model
* generation settings
* runtime limits
* visual appearance

## 9.3 Duplicate agent

Duplication copies all agent settings except:

* unique ID
* graph position
* runtime state
* transcript references

## 9.4 Delete agent

Deleting an agent must:

* remove the agent
* remove its graph node
* remove connected edges
* preserve existing historical transcript entries
* mark historical messages as belonging to a deleted agent

A confirmation should appear when the agent has conversation history or connections.

## 9.5 Enable and disable

Disabled agents remain visible but are excluded from execution.

Connections to disabled agents are ignored during a run.

---

# 10. Visual graph behavior

## 10.1 Agent nodes

Each node should display:

* agent name
* role
* provider or model abbreviation
* runtime status
* error indicator when relevant

Node visual state should distinguish:

* selected
* disabled
* currently generating
* completed
* failed

## 10.2 Graph operations

Required MVP operations:

* create node
* move node
* select node
* delete node
* create directed edge
* select edge
* delete edge
* zoom in
* zoom out
* fit graph to viewport
* reset view

`react-digraph` already uses callbacks for node creation, edge creation, selection, movement, and deletion, while the application remains responsible for updating graph state.

## 10.3 Runtime visualization

During a conversation:

* the active node receives a generating state
* the incoming edge is highlighted
* the completed node receives a completed state
* a failed node receives an error state
* the graph remains editable only when execution is stopped

The MVP should lock graph structure during execution to prevent inconsistent state.

---

# 11. Conversation model

## 11.1 Conversation setup

The run dialog contains:

* subject
* objective
* optional initial context
* selected starting agent
* execution mode
* maximum total turns
* maximum estimated cost or token limit, when available
* stop on error toggle

Required field:

* subject

Example:

> Evaluate whether a company should release an open-source version of its internal agent framework.

## 11.2 MVP execution mode

The MVP should support one reliable execution mode:

### Directed sequential conversation

Execution follows directed graph connections.

Recommended behavior:

1. Start with the selected agent.
2. Generate its response using the subject and objective.
3. Find enabled outgoing connections.
4. Queue connected target agents.
5. Execute targets sequentially.
6. Continue until the maximum turn count is reached or no valid outgoing connections remain.

Sequential execution is preferable to parallel execution in the MVP because it provides:

* deterministic ordering
* simpler state handling
* clearer transcripts
* lower provider rate-limit pressure
* easier cancellation
* easier debugging

## 11.3 Branch handling

When a node has multiple outgoing edges:

* order targets by edge priority
* execute each target sequentially
* provide each target with the relevant preceding context

The MVP should not merge divergent branch state intelligently.

Each target can receive:

* original topic
* complete transcript within configured limits
* source agent’s most recent response
* connection-specific instruction

## 11.4 Cycle handling

Graphs may contain cycles.

The orchestration engine must therefore enforce:

* maximum total turns
* maximum responses per agent
* duplicate queue protection
* user cancellation
* global execution state

Without these controls, two connected agents could converse indefinitely.

Default limits:

* maximum total turns: 12
* maximum responses per agent: 3
* timeout per response: 60 seconds

## 11.5 Starting agent

A run requires a starting agent.

The application may suggest agents with no incoming edges as starting candidates, but the user can select any enabled agent.

## 11.6 Conversation history

Each agent request should include:

* agent system instruction
* generated characteristic instructions
* enabled skill instructions
* current topic
* current objective
* relevant transcript history
* incoming connection instruction
* source agent output, when applicable

History must be bounded by:

* number of messages
* estimated character count
* provider context limit when known

Exact tokenizer support is not required in the MVP. Character-based estimation is acceptable when clearly labeled as an estimate.

---

# 12. Prompt assembly

The system should build an agent prompt from explicit sections.

Conceptual order:

1. Agent identity
2. Role
3. Primary system instruction
4. Characteristics
5. Enabled skills
6. Conversation rules
7. Current task
8. Incoming edge instruction
9. Output constraints

Example conceptual structure:

> You are Agent: Risk Reviewer.
> Role: Identify technical and business risks.
> Primary instruction: Challenge unsupported assumptions.
> Characteristics: Be skeptical, concise, and evidence-oriented.
> Skills: Risk analysis, critique, prioritization.
> Conversation rule: Respond to the latest relevant agent message.
> Task: Evaluate the proposed strategy.
> Output constraint: State the three most important risks and one mitigation for each.

The UI should provide a read-only “Preview effective prompt” panel so users can understand how configuration becomes a model instruction.

---

# 13. Transcript and execution log

## 13.1 Transcript

Each message displays:

* agent name
* role
* model
* timestamp
* message content
* turn number
* execution duration
* status
* source agent
* connection type

Message actions:

* copy
* expand
* collapse
* inspect request metadata
* retry from this agent

Retry can be deferred to a later MVP iteration if it complicates orchestration state.

## 13.2 Execution log

The event log records:

* run started
* agent queued
* provider request started
* provider request completed
* provider request failed
* agent skipped
* execution stopped
* turn limit reached
* run completed

Logs must exclude:

* API keys
* authentication headers
* full secret-bearing provider configurations

## 13.3 Request inspector

For debugging, users should see a sanitized version of:

* request URL
* provider
* model
* prompt messages
* generation parameters
* response status
* parsed error
* raw provider response, excluding sensitive headers

---

# 14. Execution controls

Required controls:

* run
* stop
* clear transcript
* rerun from beginning

The stop action must:

* abort the active browser request using request cancellation
* clear queued agents
* mark the run as stopped
* preserve completed transcript entries

Pause and resume should not be part of the first MVP unless the orchestration state is explicitly designed for resumability. “Stop” is enough.

---

# 15. Persistence

## 15.1 Browser persistence

Use browser-local persistence for:

* playground definitions
* graph layout
* agent configurations
* provider configurations
* conversation settings
* optional transcripts
* UI preferences

IndexedDB is preferable for the complete application state.

Local storage may be used only for small preferences, such as:

* selected playground ID
* panel visibility
* theme

## 15.2 Autosave

The application should autosave after meaningful state changes with a short debounce.

Save states:

* saved
* saving
* unsaved changes
* save failed

## 15.3 Import and export

Users must be able to export a playground as JSON.

Export includes:

* schema version
* playground metadata
* graph
* agents
* provider definitions without API keys
* settings
* optional transcript

Import must:

* validate JSON structure
* validate schema version
* reject malformed IDs and edges
* report missing providers
* generate new IDs when importing as a copy

---

# 16. State architecture

The application should maintain separate state domains.

## Persistent domain state

* playgrounds
* agents
* graph nodes
* graph edges
* providers
* conversation settings
* transcripts

## Temporary UI state

* selected node
* selected edge
* open panel
* graph viewport
* modal state
* form validation errors

## Runtime execution state

* run ID
* status
* queue
* active agent
* current turn
* completed turns
* abort controller
* runtime errors
* temporary request context

Do not persist an active run across page reloads in the MVP.

After reload, any previously active run should be marked as interrupted.

---

# 17. Provider adapter architecture

Even though the MVP initially supports OpenAI-compatible APIs, provider communication should be isolated behind an adapter boundary.

The adapter is responsible for:

* constructing the endpoint
* adding authentication
* adding custom headers
* converting internal messages into provider request format
* sending the request
* parsing the response
* extracting generated text
* normalizing usage data
* normalizing errors

The rest of the application should use one internal response structure:

* text
* model
* finish reason
* prompt token count
* completion token count
* total token count
* raw response
* duration
* provider status

Usage fields may be absent when the provider does not return them.

This boundary allows later support for:

* Anthropic-native APIs
* Google Gemini APIs
* local inference servers
* streaming APIs
* provider-specific model discovery

---

# 18. Streaming

Streaming is useful but should not block the MVP.

Recommended MVP decision:

* initial release uses complete non-streamed responses
* architecture leaves space for streamed token events
* transcript displays a loading state during generation

Streaming adds complexity in:

* cancellation
* partial response persistence
* error recovery
* provider differences
* UI rendering
* conversation state consistency

Implement it after the basic orchestrator is stable.

---

# 19. Validation rules

## Agent validation

An agent cannot run without:

* name
* role
* system instruction
* enabled provider
* model ID

## Provider validation

A provider cannot be tested without:

* name
* valid HTTPS endpoint, except explicitly permitted localhost development endpoints
* request path
* model
* required credential

## Graph validation

Before execution, detect:

* missing starting agent
* deleted agent references
* edges with missing source or target
* disabled starting agent
* agent without provider
* agent without model
* unreachable enabled agents
* graph with no executable route
* self-loop without sufficient turn limits

Unreachable agents should produce a warning, not an execution failure.

## Run validation

A run cannot begin when:

* another run is active
* graph state is invalid
* required provider credentials are unavailable
* maximum turns is below one

---

# 20. Error handling

Errors should be represented at three levels.

## Field error

Invalid form input.

Example:

> API base URL must be a valid URL.

## Agent execution error

One agent request failed.

Example:

> Critic failed: provider returned HTTP 429.

## Run-level error

The orchestration cannot continue.

Example:

> Execution stopped because no configured provider could be reached.

Each error should provide:

* readable summary
* technical details
* affected agent
* provider
* timestamp
* retry eligibility

The application must not expose credentials in error messages.

---

# 21. Security requirements

For a browser-only MVP:

* never include API keys in exported playgrounds
* never include API keys in logs
* mask keys in the provider editor
* provide a clear-key action
* default to session-only credential storage
* require explicit opt-in for persistent credential storage
* reject non-HTTPS remote endpoints
* permit HTTP only for localhost development
* sanitize imported text before rendering
* render model output as text or sanitized Markdown
* block arbitrary HTML from model responses
* apply a restrictive Content Security Policy in deployment
* avoid runtime evaluation of user-provided scripts
* prevent custom headers from overriding browser-controlled headers
* validate imported JSON size and structure

The application should state clearly that browser storage is not a secure secret vault.

---

# 22. Accessibility and usability requirements

Minimum requirements:

* keyboard access to all forms and controls
* visible focus states
* text equivalents for node status
* inspector editing without requiring graph gestures
* confirmation for destructive actions
* readable provider errors
* adequate contrast for runtime states
* node labels not dependent only on color
* transcript usable with screen readers
* graph actions available through buttons, not only mouse shortcuts

Graph editing libraries often depend heavily on pointer interactions. The surrounding interface must provide accessible alternatives.

---

# 23. MVP functional requirements

## FR-1: Playground management

The user can:

* create a playground
* rename it
* duplicate it
* delete it
* export it
* import it

## FR-2: Agent management

The user can:

* create an agent
* edit it
* duplicate it
* enable or disable it
* delete it

## FR-3: Visual graph editing

The user can:

* position agents
* connect agents
* remove connections
* select agents and connections
* zoom and navigate the graph

## FR-4: Provider management

The user can:

* add a custom OpenAI-compatible provider
* configure authentication
* specify one or more model IDs
* test connectivity
* edit and delete providers

## FR-5: Agent-provider assignment

Each agent can independently select:

* provider
* model
* generation settings

## FR-6: Conversation execution

The user can:

* enter a topic
* choose a starting agent
* configure maximum turns
* start execution
* stop execution
* observe graph state
* inspect the transcript

## FR-7: Persistence

The application restores saved playground state after browser reload.

## FR-8: Diagnostics

The application presents normalized provider and execution errors without exposing credentials.

---

# 24. MVP acceptance scenario

The MVP is accepted when this complete scenario works:

1. The user opens the application.
2. The user creates a new playground.
3. The user adds a custom OpenAI-compatible provider.
4. The user enters an endpoint, API key, and model.
5. The provider test succeeds.
6. The user creates three agents:

   * Strategist
   * Critic
   * Moderator
7. The user assigns roles, instructions, characteristics, and skills.
8. The user arranges the agents on the graph.
9. The user creates directed connections:

   * Strategist to Critic
   * Critic to Moderator
10. The user enters a discussion subject.
11. The user selects Strategist as the starting agent.
12. The user starts the conversation.
13. The active node and edge are visibly highlighted.
14. Each agent produces one response in sequence.
15. The transcript displays all responses with agent attribution.
16. The user edits the Critic’s instruction.
17. The user reruns the conversation.
18. The user exports the playground.
19. The exported file excludes API credentials.
20. The user reloads the page and the playground remains available.

---

# 25. Implementation phases

## Phase 0 — Technical validation

### Objective

Prove the two highest-risk assumptions before implementing the complete interface:

* `react-digraph` can support the required node and edge interactions.
* browser-origin requests can reach the intended custom providers.

### Work

* create a minimal graph with draggable typed nodes
* create and delete directed edges
* verify selection callbacks
* verify graph state can be serialized
* test representative OpenAI-compatible APIs from a browser
* inspect CORS behavior
* verify request cancellation
* define the normalized provider response structure

### Exit criteria

* graph editing works without corrupting state
* node IDs remain stable
* provider request succeeds against at least one compatible endpoint
* provider errors can be classified
* cancellation terminates an active request

---

## Phase 1 — Domain model and local persistence

### Objective

Build the non-visual foundation.

### Work

* define versioned playground schema
* define agent schema
* define connection schema
* define provider schema
* define transcript schema
* implement state separation
* implement IndexedDB persistence
* implement autosave
* implement import and export validation
* implement schema migration boundary

### Exit criteria

* a complete playground can be saved and restored
* malformed imported data is rejected
* exports exclude credentials
* interrupted runtime state is not restored as active

---

## Phase 2 — Graph workspace

### Objective

Deliver the visual editing surface.

### Work

* integrate `GraphView`
* map domain agents to graph nodes
* implement node creation
* implement node movement
* implement edge creation
* implement deletion
* implement selection
* implement custom agent-node SVG types
* add runtime node states
* add fit and reset controls
* synchronize graph and inspector selection

### Exit criteria

* users can visually construct and modify a multi-agent graph
* graph operations update persistent state
* deleting an agent removes connected edges
* graph position survives reload
* domain state remains separate from visualization state

---

## Phase 3 — Agent editor

### Objective

Allow complete agent configuration.

### Work

* create agent form
* agent inspector
* role and instruction editor
* characteristics editor
* skill list editor
* provider and model selector
* generation settings
* runtime limits
* duplicate action
* enable and disable action
* effective-prompt preview
* validation

### Exit criteria

* users can create an executable agent
* agent updates immediately affect prompt preview
* duplicated agents receive independent IDs
* invalid agents are visibly identified before execution

---

## Phase 4 — Custom provider manager

### Objective

Support user-defined LLM providers.

### Work

* provider list
* provider create and edit form
* OpenAI-compatible endpoint configuration
* authentication configuration
* custom headers
* model identifier management
* test connection
* session-only credentials
* optional local credential persistence
* normalized errors
* credential masking and clearing

### Exit criteria

* a provider can be created without application code changes
* the provider can be tested
* agents can select the provider
* keys are absent from logs and exports
* CORS errors are distinguishable from authentication errors

---

## Phase 5 — Conversation orchestrator

### Objective

Execute controlled multi-agent conversations.

### Work

* run setup dialog
* graph validation
* directed sequential traversal
* execution queue
* branch ordering
* cycle controls
* maximum turns
* per-agent response limits
* prompt construction
* bounded transcript context
* provider adapter integration
* request cancellation
* stop action
* runtime state transitions

### Exit criteria

* a connected three-agent graph executes in order
* cycles cannot run indefinitely
* stopping aborts the active request
* disabled agents are skipped
* provider failures are assigned to the correct agent
* graph editing is locked during execution

---

## Phase 6 — Transcript and observability

### Objective

Make execution understandable and debuggable.

### Work

* transcript panel
* event log
* sanitized request inspector
* duration display
* token usage display when available
* graph execution highlighting
* error details
* copy-response action
* clear transcript
* rerun from beginning

### Exit criteria

* every model response is attributable to an agent
* the user can determine why execution stopped
* request information contains no secrets
* transcript and graph states remain synchronized

---

## Phase 7 — Hardening and release preparation

### Objective

Make the MVP reliable enough for external testing.

### Work

* keyboard accessibility
* graph action alternatives
* import security validation
* Markdown sanitization
* Content Security Policy
* large-transcript handling
* provider timeout testing
* rate-limit behavior
* corrupted persistence recovery
* cross-browser testing
* empty-state design
* onboarding example playground
* deterministic acceptance tests

### Exit criteria

* acceptance scenario passes in supported browsers
* no credential appears in exports or diagnostics
* invalid state cannot start execution
* common failures produce actionable messages
* application recovers from corrupted local data

---

# 26. Recommended release boundary

The first public MVP should contain:

* one local user
* multiple local playgrounds
* editable agent graph
* custom OpenAI-compatible providers
* session or browser-local credentials
* directed sequential conversations
* bounded cycles
* transcript and execution logs
* JSON import and export
* non-streaming responses
* local persistence

Do not include tools, retrieval, server synchronization, or autonomous planning before this boundary is stable.

---

# 27. Post-MVP roadmap

## Next release

* streaming responses
* manual single-agent execution
* rerun from selected message
* graph validation overlays
* provider presets
* local model presets
* richer edge conditions
* transcript export
* conversation summaries

## Later release

* server-side provider proxy
* secure credential vault
* authenticated accounts
* shared playgrounds
* real executable tools
* knowledge sources
* file attachments
* agent memory
* parallel branches
* conditional routing
* human approval nodes
* reusable subgraphs
* execution metrics
* version history

## Platform stage

* agent template marketplace
* team workspaces
* provider usage governance
* audit logs
* evaluation suites
* scheduled workflows
* deployment APIs
* production execution workers

---

# 28. Main architectural risk

The largest MVP risk is not graph rendering. It is direct browser communication with arbitrary LLM providers.

A browser-only implementation can support custom providers only when:

* the provider accepts the expected request format
* the provider allows CORS
* the provider permits client-side credentials
* the user accepts local credential exposure
* the provider response can be normalized

The MVP should therefore describe its provider feature precisely:

> Add and use custom OpenAI-compatible LLM endpoints that permit browser-origin requests.

It should not claim universal custom-provider support.

The long-term production architecture should place provider calls behind a controlled server-side proxy. The browser-only design is suitable for local experimentation and MVP validation, not secure enterprise deployment.
