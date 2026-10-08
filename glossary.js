/**
 * glossary.js — Shared glossary for Elixir/OTP and DevOps terms.
 * Loaded as a content script before overlay.js so window.ICA_GLOSSARY is available.
 */

window.ICA_GLOSSARY = {
  // ── Elixir / OTP ──────────────────────────────────────────────────────────
  "GenServer": "A behaviour module for implementing server processes in Elixir OTP. Abstracts the client-server interaction pattern.",
  "Supervisor": "An OTP behaviour that monitors worker processes and restarts them when they crash, enabling fault-tolerant systems.",
  "OTP": "Open Telecom Platform — a set of libraries and design principles for building fault-tolerant, concurrent Erlang/Elixir applications.",
  "BEAM": "The Erlang virtual machine. Runs Elixir code and provides lightweight processes, preemptive scheduling, and soft real-time guarantees.",
  "Actor model": "Concurrency paradigm where actors are independent processes that communicate only via asynchronous message passing.",
  "pattern matching": "Elixir/Erlang feature allowing values to be matched against patterns, enabling powerful control flow and data destructuring.",
  "pipe operator": "The |> operator in Elixir that passes the result of the left expression as the first argument to the right function.",
  "process": "A lightweight concurrent unit of execution in the BEAM VM. Isolated memory, communicates via messages.",
  "message passing": "The only way BEAM processes communicate — by sending immutable messages to each other's mailboxes.",
  "fault tolerance": "System design property where failures are isolated and recovered from without affecting the overall system.",
  "let it crash": "OTP philosophy: let processes crash rather than writing defensive code; use supervisors to recover.",
  "hot code reload": "The ability to upgrade running code without stopping the system — a core BEAM/OTP feature.",
  "ETS": "Erlang Term Storage — an in-memory key-value store built into the BEAM, accessible from any process.",
  "mnesia": "A distributed real-time database built into the BEAM VM, supporting transactions and replication.",
  "Phoenix": "A web framework for Elixir built on top of Plug and Cowboy, known for performance and real-time features.",
  "LiveView": "Phoenix LiveView — server-side rendering with real-time updates via WebSockets, without writing JavaScript.",
  "Ecto": "A database wrapper and query language for Elixir, providing changesets, queries, and schema definitions.",
  "GenStage": "An Elixir library for building producer-consumer pipelines with back-pressure between stages.",
  "Task": "An Elixir module for spawning and awaiting short-lived async computations.",
  "Agent": "A simple abstraction in Elixir for maintaining state in a separate process.",

  // ── DevOps ────────────────────────────────────────────────────────────────
  "CI/CD": "Continuous Integration / Continuous Delivery — practices of automating build, test, and deployment pipelines.",
  "Docker": "A platform for building, shipping, and running applications in containers — lightweight isolated environments.",
  "Kubernetes": "An open-source system for automating deployment, scaling, and management of containerised applications.",
  "Helm": "The package manager for Kubernetes, using charts to define, install, and manage Kubernetes applications.",
  "pipeline": "An automated sequence of steps in CI/CD, typically including build, test, and deploy stages.",
  "deployment": "The process of releasing a new version of software to a target environment.",
  "container": "A lightweight, portable unit that packages code and its dependencies for consistent execution.",
  "pod": "The smallest deployable unit in Kubernetes, containing one or more containers that share storage and network.",
  "ingress": "A Kubernetes resource that manages external HTTP/HTTPS access to services within a cluster.",
  "service mesh": "An infrastructure layer (e.g. Istio) that manages service-to-service communication, observability, and security.",
  "observability": "The ability to understand a system's internal state from its outputs: logs, metrics, and traces.",
  "blue-green deployment": "A release strategy using two identical environments; traffic is switched from blue (old) to green (new).",
  "canary release": "Gradually routing a small percentage of traffic to a new version to detect issues before full rollout.",
  "IaC": "Infrastructure as Code — managing and provisioning infrastructure through machine-readable config files.",
  "Terraform": "An IaC tool by HashiCorp for provisioning and managing cloud infrastructure declaratively.",
  "Ansible": "An agentless IT automation tool for configuration management, application deployment, and orchestration.",
  "microservices": "An architectural style structuring an app as a collection of small, independently deployable services.",
  "load balancer": "A device or software that distributes network traffic across multiple servers for reliability and performance.",
  "reverse proxy": "A server that forwards client requests to backend servers, used for load balancing, caching, and SSL termination.",
  "autoscaling": "Automatically adjusting compute resources in response to load changes.",
  "SLA": "Service Level Agreement — a commitment to a specific level of service availability or performance.",
  "SLO": "Service Level Objective — a target value for a service reliability metric (e.g. 99.9% uptime).",
  "SLI": "Service Level Indicator — a quantitative measure of some aspect of the service level.",

  // ── Distributed Systems ───────────────────────────────────────────────────
  "CAP theorem": "States that a distributed system can provide only two of: Consistency, Availability, Partition tolerance.",
  "consensus": "Agreement among distributed nodes on a single data value or decision. Achieved via algorithms like Raft or Paxos.",
  "Raft": "A consensus algorithm designed to be more understandable than Paxos, used in etcd and CockroachDB.",
  "Paxos": "A family of protocols for achieving consensus in a distributed network of potentially unreliable processors.",
  "eventual consistency": "A consistency model where replicas will converge to the same value given enough time without updates.",
  "idempotency": "A property where applying an operation multiple times produces the same result as applying it once.",
  "sharding": "Horizontal partitioning of a database, distributing rows across multiple database instances.",
  "replication": "Copying and maintaining database objects in multiple databases that make up a distributed database system.",
  "circuit breaker": "A pattern that stops calling a failing service temporarily to give it time to recover.",
  "backpressure": "A mechanism to slow down producers when consumers cannot process data fast enough.",
  "CQRS": "Command Query Responsibility Segregation — separating read and write models for scalability.",
  "event sourcing": "Storing state changes as a sequence of events rather than the current state."
};
