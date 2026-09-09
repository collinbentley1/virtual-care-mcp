import type { MediaResult } from "../contracts.ts";
import type { RemoteTrackPublication, Room } from "livekit-client";

type MediaMode = "video" | "audio";
type Options = {
	join: (mode: MediaMode) => Promise<MediaResult>;
	openBrowser: () => Promise<void>;
};

export function createMediaPanel(options: Options) {
	const element = document.createElement("section");
	element.className = "media-panel";
	element.setAttribute("aria-label", "Call and device preview");
	element.innerHTML = `<div class="media-stage" hidden><div class="media-placeholder"><p>Waiting for video</p></div><div class="media-videos"></div></div><div class="media-audio"></div><div class="media-controls"><button class="button" id="media-join" data-media="join">Join call</button><button class="button button-secondary" id="media-preview" data-media="preview">Preview devices</button><button class="button button-secondary" id="media-microphone" data-media="microphone" hidden>Turn microphone on</button><button class="button button-secondary" id="media-camera" data-media="camera" hidden>Turn camera on</button><button class="button button-secondary" id="media-sound" data-media="sound" hidden>Enable sound</button><button class="button button-secondary" id="media-stop" data-media="stop" hidden>Disconnect</button><button class="text-button small" id="media-browser" data-media="browser" hidden>Open in browser</button></div><p class="media-status" role="status" aria-live="polite">Join with your microphone and camera off. Preview devices checks them without joining.</p>`;
	const stage = child(".media-stage");
	const videos = child(".media-videos");
	const audio = child(".media-audio");
	const placeholder = child(".media-placeholder");
	const status = child(".media-status");
	let preview: MediaStream | undefined;
	let room: Room | undefined;
	let mode: MediaMode = "audio";
	let textMode = false;
	let visitId = "";
	let working = false;
	let microphoneOn = false;
	let cameraOn = false;
	let operation = 0;

	function child(selector: string): HTMLElement {
		const result = element.querySelector<HTMLElement>(selector);
		if (!result) throw new Error("A demo media control is missing.");
		return result;
	}

	function control(name: string): HTMLButtonElement {
		const result = element.querySelector<HTMLButtonElement>(`[data-media="${name}"]`);
		if (!result) throw new Error("A demo media button is missing.");
		return result;
	}

	function setWorking(active: boolean): void {
		working = active;
		for (const button of element.querySelectorAll<HTMLButtonElement>("button")) button.disabled = active;
	}

	function setConnectedControls(active: boolean): void {
		control("microphone").hidden = !active;
		control("camera").hidden = !active || mode === "audio";
		control("stop").hidden = !active;
		control("preview").hidden = textMode || active;
		control("join").hidden = textMode || Boolean(room);
		control("microphone").textContent = microphoneOn ? "Turn microphone off" : "Turn microphone on";
		control("camera").textContent = cameraOn ? "Turn camera off" : "Turn camera on";
	}

	function showVideoState(): void {
		placeholder.hidden = videos.childElementCount > 0;
		stage.hidden = videos.childElementCount === 0 && !(room && mode === "video");
	}

	async function stop(): Promise<void> {
		operation++;
		const previousRoom = room;
		room = undefined;
		if (preview) for (const track of preview.getTracks()) track.stop();
		preview = undefined;
		videos.replaceChildren();
		audio.replaceChildren();
		microphoneOn = false;
		cameraOn = false;
		showVideoState();
		control("sound").hidden = true;
		setConnectedControls(false);
		status.textContent = textMode ? "Text conversation" : "Disconnected. Your visit and messages are saved.";
		if (previousRoom) await previousRoom.disconnect();
	}

	function connectionStatus(): void {
		if (!room) return;
		const count = room.remoteParticipants.size;
		status.textContent = count ? `Connected with ${count} other ${count === 1 ? "participant" : "participants"}.` : "Connected. Waiting for another participant.";
	}

	async function startPreview(current: number): Promise<void> {
		if (!navigator.mediaDevices?.getUserMedia) {
			status.textContent = "This view cannot access devices. Open the visit in a browser or continue with text practice.";
			return;
		}
		const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: mode === "video" ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15 } } : false });
		if (current !== operation) { for (const track of stream.getTracks()) track.stop(); return; }
		preview = stream;
		microphoneOn = true;
		cameraOn = true;
		if (mode === "video") {
			const video = document.createElement("video");
			video.autoplay = true; video.muted = true; video.playsInline = true; video.setAttribute("aria-label", "Your local device preview"); video.srcObject = preview;
			videos.append(video); showVideoState();
		}
		status.textContent = "Device preview. You have not joined the call.";
		setConnectedControls(true);
	}

	async function join(current: number): Promise<void> {
		status.textContent = "Checking call availability…";
		const access = await options.join(mode);
		if (current !== operation) return;
		if (access.kind !== "livekit") { status.textContent = access.message; return; }
		status.textContent = "Connecting with your microphone and camera off…";
		const { Room, RoomEvent, Track } = await import("virtual-care-livekit");
		if (current !== operation) return;
		const active = new Room({ adaptiveStream: true, dynacast: true });
		room = active;
		const subscribe = (publication: RemoteTrackPublication) => {
			if (room === active) publication.setSubscribed(publication.kind === Track.Kind.Audio || mode === "video");
		};
		active.on(RoomEvent.TrackPublished, subscribe);
		active.on(RoomEvent.TrackSubscribed, (track) => {
			if (room !== active) return;
			const media = track.attach();
			if (track.kind === Track.Kind.Video) { videos.append(media); showVideoState(); }
			else audio.append(media);
		});
		active.on(RoomEvent.TrackUnsubscribed, (track) => { for (const media of track.detach()) media.remove(); showVideoState(); });
		active.on(RoomEvent.LocalTrackPublished, (publication) => {
			if (room !== active) { publication.track?.stop(); return; }
			if (publication.kind !== Track.Kind.Video || !publication.track) return;
			const video = publication.track.attach(); video.muted = true; videos.append(video); showVideoState();
		});
		active.on(RoomEvent.LocalTrackUnpublished, (publication) => { for (const media of publication.track?.detach() ?? []) media.remove(); showVideoState(); });
		active.on(RoomEvent.ParticipantConnected, connectionStatus);
		active.on(RoomEvent.ParticipantDisconnected, connectionStatus);
		active.on(RoomEvent.Reconnecting, () => { status.textContent = "Reconnecting. You can continue the text conversation."; });
		active.on(RoomEvent.Reconnected, connectionStatus);
		active.on(RoomEvent.Disconnected, () => { if (room === active) { room = undefined; void stop(); status.textContent = "Call disconnected. Rejoin or continue the text conversation."; } });
		active.on(RoomEvent.AudioPlaybackStatusChanged, () => { if (room === active) control("sound").hidden = active.canPlaybackAudio; });
		await active.connect(access.serverUrl, access.token, { autoSubscribe: false });
		if (current !== operation) { await active.disconnect(); return; }
		for (const participant of active.remoteParticipants.values()) for (const publication of participant.trackPublications.values()) subscribe(publication);
		setConnectedControls(true);
		showVideoState();
		connectionStatus();
	}

	async function toggleDevice(device: "microphone" | "camera", current: number): Promise<void> {
		const active = room;
		const enabled = !(device === "microphone" ? microphoneOn : cameraOn);
		const publication = active ? await (device === "microphone"
			? active.localParticipant.setMicrophoneEnabled(enabled)
			: active.localParticipant.setCameraEnabled(enabled, { resolution: { width: 640, height: 360, frameRate: 15 } })) : undefined;
		if (current !== operation || room !== active) {
			const track = publication?.track;
			if (track) {
				track.stop();
				if (active) await active.localParticipant.unpublishTrack(track);
			}
			return;
		}
		if (preview) for (const track of device === "microphone" ? preview.getAudioTracks() : preview.getVideoTracks()) track.enabled = enabled;
		if (device === "microphone") microphoneOn = enabled;
		else cameraOn = enabled;
		setConnectedControls(true);
	}

	element.addEventListener("click", (event) => {
		if (!(event.target instanceof Element)) return;
		const button = event.target.closest<HTMLButtonElement>("button[data-media]");
		if (!button || working) return;
		void (async () => {
			setWorking(true);
			let current = operation;
			try {
				if (button.dataset.media === "preview" || button.dataset.media === "join") {
					const clearing = stop();
					current = operation;
					await clearing;
					if (current !== operation) return;
				}
				switch (button.dataset.media) {
					case "preview": await startPreview(current); break;
					case "join": await join(current); break;
					case "stop": await stop(); break;
					case "browser": await options.openBrowser(); break;
					case "sound": await room?.startAudio(); break;
					case "microphone": await toggleDevice("microphone", current); break;
					case "camera": await toggleDevice("camera", current); break;
				}
			} catch (error) {
				if (current !== operation) return;
				if (button.dataset.media === "sound") {
					control("sound").hidden = false;
					status.textContent = "Audio could not start. Select Enable sound to try again.";
					return;
				}
				if (button.dataset.media !== "microphone" && button.dataset.media !== "camera") await stop();
				const recovery = room ? "The call is still connected." : "You can continue with text.";
				status.textContent = error instanceof DOMException && error.name === "NotAllowedError" ? `Device access was not allowed. ${recovery}` : error instanceof DOMException && error.name === "NotFoundError" ? `The requested device was not found. ${recovery}` : `The connection or device could not start. ${recovery}`;
			} finally { setWorking(false); }
		})();
	});

	return {
		element,
		stop,
		configure(input: { visitId: string; mode: "video" | "audio" | "text"; embedded: boolean }): void {
			const changed = visitId !== input.visitId || textMode !== (input.mode === "text") || mode !== (input.mode === "video" ? "video" : "audio");
			if (visitId && changed) void stop();
			visitId = input.visitId;
			textMode = input.mode === "text";
			mode = input.mode === "video" ? "video" : "audio";
			control("browser").hidden = !input.embedded;
			if (!room && !preview) { setConnectedControls(false); if (changed) status.textContent = textMode ? "Text conversation" : "Join with your microphone and camera off. Preview devices checks them without joining."; }
		},
	};
}
