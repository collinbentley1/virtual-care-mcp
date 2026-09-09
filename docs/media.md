# Optional LiveKit media

The default visit is a scripted rehearsal. Without media configuration, the authenticated media endpoint returns `kind: "practice"` and `reason: "unconfigured"`. No clinician is connected. Local device preview, generated test media, and a call between testers are separate experiences.

`createMediaService({ care, config, now }).join(input)` in `src/media.ts` authenticates the synthetic visit through `care.resume`. A visit must be in `consulting` state. Text consultations return the text practice result. An audio consultation cannot obtain a camera grant; a video consultation can request an audio-only grant.

The server signs the [documented LiveKit JWT contract](https://docs.livekit.io/frontends/reference/tokens-grants/) with WebCrypto HMAC SHA-256. It does not implement WebRTC itself. The UI uses the official LiveKit client. The server adapter adds no JWT package dependency.

Each grant has an opaque tester identity and a room name derived from the consultation UUID and generation. Two authorized testers can use the same fictional visit and receive different identities in the same room. This is a shared demo capability, not patient authentication or a clinician invitation system. No caller can select a provider or administrator role.

The JWT permits room join, track subscription, and publication of the microphone or camera sources selected for that request. It explicitly denies room administration, room creation, room listing, recording, ingress management, metadata changes, and data publication. Screen sharing and telephony are absent.

Tokens expire after at most 120 seconds, capped by the visit's expiry. After signing, the adapter reads the visit again and discards the grant if the consultation closed or changed during preparation. The signing race test finishes the visit between these reads and verifies refusal. A final state read and a network response are not one atomic transaction; a visit can still close after that read.

Finishing or cancelling a visit prevents grants on requests that observe the closed state. The UI must disconnect its current client and stop its local tracks when leaving. This implementation does not delete LiveKit rooms, remove other participants, consume webhooks, or revoke previously issued tokens. A tester with an already issued token can still join its old room while the token remains valid. Token expiry does not terminate an established call, and LiveKit can refresh tokens for connected clients. Self-hosted token revocation is not available according to the [LiveKit lifecycle documentation](https://docs.livekit.io/frontends/reference/tokens-grants/#token-lifecycle).

Media results are ephemeral. The MCP tool is app-only and returns the result in `_meta["virtual-care/media"]`. The HTTP endpoint returns the result directly. Keep tokens in memory, and never copy them into model-visible content, URLs, browser storage, logs, or saved visit records. The service's `config` must remain server-side.

## Local self-host setup

Use an isolated local LiveKit service for development. The tested server version is `v1.13.6`, pinned to its multi-platform image digest:

```text
livekit/livekit-server@sha256:e37d68f172556d02aa77968b9fc55ef481468c0315fa38e4fa6c56ce72e3a815
```

The Linux arm64 image digest is `sha256:4eeb7a7af9e133afee7d07fc48623373852a34ad709094345d1761c9b283dc1a`. The server is Apache 2.0 licensed. See the [self-hosting guide](https://docs.livekit.io/transport/self-hosting/) and the [pinned configuration example](https://github.com/livekit/livekit/blob/v1.13.6/config-sample.yaml).

Create a private directory outside this repository. Generate a random API key and a secret of at least 32 characters, then write the following server configuration there with mode `0600`. Replace the two placeholders locally. Do not commit the completed file.

```yaml
port: 7880
bind_addresses: ["0.0.0.0"]
rtc:
  tcp_port: 7881
  udp_port: 7882
  node_ip: 127.0.0.1
  use_external_ip: false
keys:
  YOUR_RANDOM_API_KEY: YOUR_RANDOM_API_SECRET
logging:
  level: error
```

Set `VCM_LIVEKIT_CONFIG` to that file's absolute path. This variable contains a path, not a key. Start the local server with ports exposed only on loopback:

```sh
docker run --rm --name virtual-care-livekit \
  --publish 127.0.0.1:7880:7880 \
  --publish 127.0.0.1:7881:7881 \
  --publish 127.0.0.1:7882:7882/udp \
  --mount "type=bind,src=$VCM_LIVEKIT_CONFIG,dst=/etc/livekit.yaml,readonly" \
  livekit/livekit-server@sha256:e37d68f172556d02aa77968b9fc55ef481468c0315fa38e4fa6c56ce72e3a815 \
  --config /etc/livekit.yaml
```

The application entry point reads `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` together from its server environment. Configure these through the server's private configuration mechanism; do not put credential values in command arguments or print the environment. Use `ws://127.0.0.1:7880` for this local test. The entry point passes `media.join` to the HTTP/MCP application and allows the LiveKit origin in `mediaConnectOrigins`. If embedding the service directly, pass `{ serverUrl, apiKey, apiSecret }` as `createMediaService`'s `config`. The web UI runs on its own local HTTP origin; LiveKit is the separate signalling and media service.

For a remote deployment, configure a reachable `wss:` endpoint, TLS, and the required media ports or TURN support according to the upstream guide. The adapter rejects plaintext `ws:` outside loopback, credentials embedded in a URL, and URLs containing query strings or fragments. Deploying the HTTP app does not deploy a media server.

Stop the local server with `docker stop virtual-care-livekit`. Remove the private generated configuration after the test. Never reuse local test keys for a public server.

## Verification boundaries

`bun test test/media.test.ts` uses the real care service and memory store. It independently checks the JWT signature with Node's HMAC implementation, verifies scope and expiry, exercises two tester identities, tests audio/text restrictions and denied authorization, checks the finish/signing race, and confirms that the visit store contains no media token.

A successful token test proves the grant contract. A local preview proves device access. To prove transport, open the same synthetic consulting visit in two browser clients, obtain distinct participant grants, publish a track from each, and confirm each receives the other's tracks. Test audio-only operation separately. Record whether tracks were generated fixtures or real devices. Packet/frame counters and decoded remote media provide stronger evidence than connected-room labels alone.

On September 9, 2026, two independent Chrome tabs connected through a local `v1.13.6` LiveKit container using this adapter and the official `livekit-client@2.22.2`. The isolated test page used real care-service authorization and generated a canvas video track plus an oscillator audio track for each tester. Both clients saw one remote participant and two remote tracks. One observed sample recorded 285 received audio packets and 39 decoded video frames on A, and 307 audio packets and 45 decoded video frames on B. A Web Audio analyser measured nonzero decoded remote audio RMS on both sides, approximately 0.105 and 0.106. Output gain was zero, so no test tone played through the user's speakers. The received video visibly contained the other tester's generated label and changing frame counter. No personal camera or microphone was used.

Both clients then disconnected and rejoined using audio-only grants. Each received exactly one remote audio track, with zero received video packets and zero decoded video frames. The observed audio packet counts were 1,084 and 1,102, with nonzero decoded audio RMS on both clients. After the fixture visit finished, another join attempt returned the adapter's closed-consultation error. The clients disconnected and stopped all generated tracks.

This establishes bidirectional local media transport and LiveKit's acceptance of the emitted tokens. It is an adapter test in an isolated page, not a test of the final app UI, a public network, a clinician connection, or embedded ChatGPT/Claude media permission.

### Prerecorded fictional clinician verification

A second local test on September 9, 2026 used three matching AI-generated stills of an entirely fictional adult clinician. FFmpeg assembled them into a silent 10.5-second H.264 loop at 960 by 540 pixels and 24 frames per second. Every frame carries the label "Fictional clinician · prerecorded demo". The 209,746-byte clip has SHA-256 `1722a42b1a93f13327af2b03b33d18aa766cb88d87a616bdece15d795d10a238`.

The images were generated through ChatGPT Images with a request for GPT Image 2.5 Sunburst if available. The UI did not expose the actual image model. Readable content-credential fields in the PNG included `gpt-image` and version `2.0`; the content credentials were not cryptographically validated. The actual generation model remains unverified, and this test does not establish that Sunburst was used.

The sender published the clip through `HTMLVideoElement.captureStream()` and the official LiveKit client. A separate receive-only Chrome tab decoded 590 video frames and displayed 584 frames through `requestVideoFrameCallback`, while the sender completed two loops. A follow-up with a separate generated 440 Hz tone recorded 822 received audio packets, decoded audio RMS of approximately 0.105, 399 decoded video frames, and 396 displayed frames. The clip itself contains no audio or speech. The receiver muted audio output and used a zero-gain Web Audio output for measurement. Neither tab requested camera or microphone access.

After the synthetic visit finished, both clients disconnected. The source video was paused and the receiver had no remaining media elements. A new join attempt returned "Media is available only during an active synthetic consultation." This proves local receive-only delivery of the prerecorded clip and generated audio through the adapter. Final app UI and embedded-host media behavior require separate evidence.

The [account verification record](verification-host-accounts.md) separately records the built app receiving this video and generated audio inside ChatGPT, with microphone and camera off, continued playback during a saved message, and removal of media elements after completion. That test used loopback ICE on the same Mac; it does not establish remote-network connectivity.

Embedded camera/microphone capture and browser handoff require separate host testing. The MCP Apps permission declaration is a request to the host. It does not prove ChatGPT or Claude permits embedded media. Live captions are not implemented; the saved scripted transcript is not a transcription of live speech. The practice journey remains usable without media.
