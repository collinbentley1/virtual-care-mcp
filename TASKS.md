# Virtual Care MCP work plan

- [x] Ground: inspect platform conventions and current MCP Apps, host, teleconference, and billing standards.
- [x] Sketch: compare two architecture candidates against portability, visit continuity, accessibility, protocol correctness, and maintainability.
- [x] Synthesize: choose module boundaries and typed contracts; record alternatives and rationale.
- [x] Implement: MCP server, visit UI, LiveKit integration, and mocked billing.
- [ ] Infrastructure: complete platform enrollment, protected delivery configuration, and production Firestore/Cloud Run setup.
- [x] Verify app: 74 automated tests, accessible browser flows, actual ChatGPT and Claude developer testing, and incoming prerecorded media.
- [ ] Verify deployment: final platform pins, native delivery checks, permanent endpoint, and production persistence.
- [ ] Publish: public MIT repository and verified deployment, with exact limitations recorded.
- [x] Runtime locally: verified stable Bun 1.4.2 installed and app verification repeated.
- [ ] Runtime rollout: activate platform `f857a58e3ecac63b2b3882809efbfb7136bfa6c3` through the reviewed pin PR and its exact-head checks; record WIF transition, native production delivery, and live endpoint/persistence verification separately.

The controller owns integration, verification, and completion claims. Colleagues own only assigned paths. The user authorized a new public repository, cloud resources following platform patterns, and account testing with synthetic data. No provider backend, real charges, or real clinical service is in scope.
