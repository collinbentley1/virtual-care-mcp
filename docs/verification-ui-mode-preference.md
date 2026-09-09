# Saved visit mode and low-data preference

On September 9, 2026, the controller observed in Claude that the rural sample's low-data preference overrode an explicit text-mode choice at the join screen.

The same behavior was reproduced in the built standalone UI at localhost:3089: select the rural sample, save a fictional appointment, choose Text practice while leaving Use less data checked, save intake, select demo assistance, and accept consent. Review displayed both Text practice and Less data preferred; the old join screen selected Audio first.

The correction in `src/ui/main.ts` uses the saved `access.mode` as the join screen's default. An explicit unsaved selection on the join form still takes precedence. The low-data helper now includes audio or text, so its wording is consistent with the allowed combination.

`bun run typecheck` passed after the correction. Shared build output was left untouched for the controller's combined compatibility build.

A temporary preview compiled the actual UI entrypoint in memory and served it on loopback port 3098, using the existing local demo API. Resuming the same saved visit selected Text practice on the corrected join screen; Audio first was unselected. Entering the visit opened the text practice room without a Preview devices control. The temporary preview was stopped afterward. No camera or microphone permission was requested.

The verified `src/ui/main.ts` SHA-256 was `179c2c283b163f6ffa03664c9b8e5090a7a48c2ff1f0ea8db0080439163fe343`.

The controller then supplied the combined Bun 1.4.2 build. A fresh browser tab at localhost:3089 loaded its actual `dist/public/app.js` from the static route. A new rural visit retained Use less data while Text practice was selected and saved. After consent, the rendered radio values were audio=false, video=false, text=true. Reloading the same ready-state visit kept Text practice selected. That visit was left ready, without entering the room.

The combined artifact hashes matched the controller's values: `app.js` SHA-256 `6c15ebf0946d5f6b4633d8edf87f4094a422bc1cb46d33409382f0cf01f55b41`; MCP HTML SHA-256 `3365bde5fdbeccdb3ae59667d60df284668a1db6c8af061f697f3f7c7d5a82da`. The local server process was not restarted because its static JavaScript route reads the current file. This verifies the combined UI bundle for the preference correction, not the separate server compatibility correction or a commercial-host recheck.
