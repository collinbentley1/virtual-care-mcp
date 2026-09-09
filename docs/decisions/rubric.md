# Architecture comparison

Score each design from 1 to 5 using these criteria. The controller and an independent Astra colleague compare both complete candidates before implementation.

1. Portability: direct MCP Apps 2.0 contracts, ChatGPT and Claude support, and a usable text fallback.
2. Visit continuity: refresh, concurrent host/device access, reconnect, and explicit retention behavior.
3. Inclusive access: low bandwidth, audio-only access, caregiver involvement, clear language, keyboard and screen-reader use.
4. Protocol correctness: typed visit transitions, idempotency, media permission boundaries, standard x402 and insurance projections.
5. Maintainability: few public operations, domain decisions in one place, platform-compatible persistence and deployment, and no unnecessary provider backend.

The current implementation scope is an end-to-end synthetic care journey. Real clinical care, real eligibility checks, real insurance claims, and real charges require separate integrations.
