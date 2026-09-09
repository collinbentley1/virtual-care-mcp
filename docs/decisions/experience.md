# Experience direction

Virtual Care MCP should help a person complete one visit at a time. The visual anchor is the current task and the next clear action, with the visit summary always reachable. The same visit UI must fit a narrow chat panel and a full browser window.

## Visual system

- Page blue `#edf5fa`, paper white `#ffffff`, ink blue `#16354a`, primary teal `#006d70`, soft blue `#dcebf2`, warning brown `#7b4212`.
- Use the device's system sans-serif font with an 18px default, generous line height, a larger-text control, and no font network request.
- Use a 48px minimum target for primary controls, visible keyboard focus, plain labels, reduced-motion support, and no color-only status meaning.
- The appointment is a progressive journey with a small persistent progress rail. Avoid a dashboard of equal cards. Show one primary decision at a time.
- Use a compact, persistent "Simulated care" indicator and clear language at booking, payment, room entry, and note generation.

## Layout

```text
Virtual Care MCP                         Display options
Simulated care

Your visit              | What would you like help with?
Appointment             | A short description is enough.
Before your visit       | [ reason for visit             ]
Visit room              | [                              ]
After your visit        |
                        | [Continue]
                        | Your answers are saved as you go.
```

On small screens the progress rail becomes an accessible horizontal step list above the current task. Do not shrink form controls to fit the desktop layout.

## Care access

Ask where the person will physically be during the visit, preferred language, communication needs, and whether a caregiver will join. Avoid unnecessary demographic fields. Offer low-bandwidth and audio-only choices before camera setup. A weak connection must not discard intake or hide after-visit information.

The visit room explains whether a real media service is connected, whether anyone has joined, and which actions are simulated. After-visit notes identify their source. Download and print should produce an understandable record with its simulation status intact.

## Review against the brief

The first layout idea was a marketing landing page with a prominent care slogan. It does not help someone who is already asking an assistant for care. Start with the visit task instead. Cool blue and teal distinguish the clinical workflow from the warm cream and orange defaults of chat products. System typography avoids another download on rural connections.
