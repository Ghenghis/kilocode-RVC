const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"

export async function synthesizeAzure(
	text: string,
	opts: { region: string; apiKey: string; voiceId: string },
): Promise<Blob> {
	if (!opts.region) throw new Error("Azure region is not configured")
	if (!opts.apiKey) throw new Error("Azure API key is not configured")
	if (!opts.voiceId) throw new Error("Azure voice is not selected")

	const ssml =
		`<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
		`<voice name='${opts.voiceId}'>${escapeXml(text)}</voice></speak>`

	const resp = await fetch(`https://${opts.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
		method: "POST",
		headers: {
			"Ocp-Apim-Subscription-Key": opts.apiKey,
			"Content-Type": "application/ssml+xml",
			"X-Microsoft-OutputFormat": OUTPUT_FORMAT,
			"User-Agent": "KiloCode",
		},
		body: ssml,
	})

	if (!resp.ok) throw new Error(`Azure TTS error ${resp.status}: ${await resp.text()}`)
	return resp.blob()
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;")
}
